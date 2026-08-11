const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const axios = require("axios");

// ---------------- EXPRESS SETUP ----------------
const app = express();
app.use(bodyParser.json());

console.log("🚀 Starting Facebook Webhook Server...");

// ---------------- LOGGING UTILITY ----------------
const LOG_FILE = "webhook_log.txt";
function log(message) {
  const text = `[${new Date().toISOString()}] ${message}`;
  console.log(text);
  try {
    fs.appendFileSync(LOG_FILE, text + "\n", "utf8");
  } catch (err) {
    console.error("Log write error:", err.message);
  }
}

// ---------------- FACEBOOK APP CONFIGS ----------------
const facebookApps = [
  {
    appId: "2137991523804159",
    appSecret: "47e656ca32cb844b2da697c7b7176691",
    accessToken: "EAAeYffFPIZC8BSJJ3ohZC9iTfV9ZC6BDgLkLrr5yvOG90GaNpM7u4yQeZCODY8CkA2kiaL5Pl1mG16dZAzFx0mtCHWhKrNO6Wwk3YPrsHB4lg94sYfErZCMC0WTQvxZAlflGTfs8P06WM8s5oVwh3hdZAKPZAHcBSvOZC6jhfmvkaiOf0mLdBWUEAD6NL7qqN9IeXZC",
    verifyToken: "Chinni@143",
    name: "sudheer_demo",
    numberId: "8",
    companyid: "1312u234u35u",
  },
];

console.log(`📋 Loaded ${facebookApps.length} Facebook app(s)`);

// ---------------- HELPER FUNCTIONS ----------------
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url);
      return res.data;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function enrichLeadData(leadId, token) {
  const leadUrl = `https://graph.facebook.com/v18.0/${leadId}?fields=id,created_time,field_data,form_id,ad_id,adset_id,campaign_id,is_organic&access_token=${token}`;
  const lead = await fetchWithRetry(leadUrl);
  if (!lead) return {};

  let adName = null;
  let adsetName = null;
  let campaignName = null;
  let formName = null;

  if (lead.form_id) {
    const form = await fetchWithRetry(
        `https://graph.facebook.com/v18.0/${lead.form_id}?fields=name&access_token=${token}`,
    );
    formName = form?.name || null;
  }

  if (lead.ad_id) {
    const ad = await fetchWithRetry(
        `https://graph.facebook.com/v18.0/${lead.ad_id}?fields=name&access_token=${token}`,
    );
    adName = ad?.name || null;
  }

  if (lead.adset_id) {
    const adset = await fetchWithRetry(
        `https://graph.facebook.com/v18.0/${lead.adset_id}?fields=name&access_token=${token}`,
    );
    adsetName = adset?.name || null;
  }

  if (lead.campaign_id) {
    const campaign = await fetchWithRetry(
        `https://graph.facebook.com/v18.0/${lead.campaign_id}?fields=name&access_token=${token}`,
    );
    campaignName = campaign?.name || null;
  }

  return {...lead, adName, adsetName, campaignName, formName};
}

// ---------------- NOTIFICATION FUNCTION ----------------
async function sendNotification(appName) {
  const notificationUrl = "https://notifications-5xky4wiyxa-uc.a.run.app/send-notification";
  const payload = {
    title: `New Lead from ${appName}`,
    body: "You got a new Facebook lead. Please check your dashboard.",
  };
  try {
    await axios.post(notificationUrl, payload);
    log(`[${appName}] Notification sent`);
  } catch (err) {
    log(`[${appName}] Notification failed: ${err.message}`);
  }
}

// ---------------- CALL NOW FUNCTION ----------------
async function callNow(numberId, appName) {
  if (!numberId) {
    log(`[${appName}] ⚠️ No numberId provided, skipping call`);
    return;
  }

  try {
    const callUrl = `https://attendance-5xky4wiyxa-uc.a.run.app/callNow/${numberId}`;
    const response = await axios.get(callUrl, {timeout: 10000});
    log(`[${appName}] 📞 CallNow triggered successfully for ${numberId}`);
    return response.data;
  } catch (err) {
    log(`[${appName}] ❌ CallNow failed for ${numberId}: ${err.message}`);
    return null;
  }
}

// ---------------- WEBHOOKS ----------------
facebookApps.forEach((appConfig) => {
  console.log(`✅ Setting up webhook for: ${appConfig.name}`);
  
  // VERIFY ENDPOINT
  app.get(`/webhook/${appConfig.name}`, (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log(`[${appConfig.name}] Webhook verification request received`);
    console.log(`  mode: ${mode}, token: ${token}, challenge: ${challenge}`);

    if (mode === "subscribe" && token === appConfig.verifyToken) {
      log(`[${appConfig.name}] ✅ Webhook verified`);
      res.status(200).send(challenge);
    } else {
      console.log(`[${appConfig.name}] ❌ Verification failed`);
      res.sendStatus(403);
    }
  });

  // RECEIVE ENDPOINT
  app.post(`/webhook/${appConfig.name}`, async (req, res) => {
    console.log(`[${appConfig.name}] 📩 Webhook POST received`);
    
    // Immediately return 200 to acknowledge receipt
    res.sendStatus(200);

    try {
      const leadId = req.body?.entry?.[0]?.changes?.[0]?.value?.leadgen_id;

      if (!leadId) {
        log(`[${appConfig.name}] No leadgen_id found`);
        console.log(`[${appConfig.name}] Request body:`, JSON.stringify(req.body, null, 2));
        return;
      }

      log(`[${appConfig.name}] Processing lead: ${leadId}`);

      const data = await enrichLeadData(leadId, appConfig.accessToken);

      if (!data.id) {
        log(`[${appConfig.name}] Invalid lead data`);
        return;
      }

      // Extract field data
      const fields = {};
      if (Array.isArray(data.field_data)) {
        data.field_data.forEach((f) => {
          if (f.name) fields[f.name] = f.values?.[0] || "";
        });
      }

      // Get phone number from fields
      const phoneNumber = fields.phone_number || fields.phone || fields.mobile_number || "";

      // Prepare payload for new API
      const payload = {
        companyId: appConfig.companyid,
        name: fields.full_name || fields.name || fields.customer_name || "",
        phone: phoneNumber,
        email: fields.email || fields.email_address || "",
        message: fields.message || fields.comments || "",
        source: "Facebook",
        campaign: data.campaign_name || "",
        adSet: data.adset_name || "",
        ad: data.ad_name || "",
        formName: data.form_name || "",
        formId: data.form_id || "",
        leadId: data.id,
        createdTime: data.created_time || new Date().toISOString(),
        status: "new",
        metaData: {
          ad_id: data.ad_id || null,
          adset_id: data.adset_id || null,
          campaign_id: data.campaign_id || null,
          is_organic: data.is_organic || null,
          facebookAppName: appConfig.name,
        }
      };

      console.log(`[${appConfig.name}] 📤 Sending payload to API:`, JSON.stringify(payload, null, 2));

      // Save to new API endpoint
      const apiUrl = "https://us-central1-kiran-interior-b7e9c.cloudfunctions.net/interiorhubleads/leads";

      try {
        const response = await axios.post(apiUrl, payload, {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 15000,
        });

        log(
            `[${appConfig.name}] ✅ Lead saved to Interior Hub API: ${
              response.data?.id || "success"
            }`,
        );

        console.log(`[${appConfig.name}] API Response:`, JSON.stringify(response.data, null, 2));

        // Trigger voice call if phone number exists
        if (phoneNumber) {
          try {
            const voicePayload = {
              phoneNumber: phoneNumber,
              agentId: 17561,
              provider: "edesy-ivr",
              variables: {
                customer_name: payload.name || "Customer",
                lead_id: response.data?.id || "",
                company_id: appConfig.companyid,
              },
            };

            const voiceResponse = await axios.post(
                "https://voice-agent.edesy.in/api/v1/calls/",
                voicePayload,
                {
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer vp_live_c80f78081f8cc718882a0626e04fc81e503798e8a150dc5d4979b6dfcc054f65",
                  },
                  timeout: 15000,
                },
            );

            log(
                `[${appConfig.name}] 📞 Voice call created successfully for ${phoneNumber}`,
            );
            console.log("Voice API Response:", voiceResponse.data);
          } catch (voiceErr) {
            log(
                `[${appConfig.name}] ❌ Voice API Error: ${
                  voiceErr.response?.data ?
                    JSON.stringify(voiceErr.response.data) :
                    voiceErr.message
                }`,
            );
          }
        } else {
          log(`[${appConfig.name}] ⚠️ No phone number found, skipping voice call`);
        }

      } catch (err) {
        log(
            `[${appConfig.name}] ❌ API save failed: ${
              err.response?.data ?
                JSON.stringify(err.response.data) :
                err.message
            }`,
        );
        return;
      }

      // Trigger call (don't await if you want it to run in background)
      callNow(appConfig.numberId, appConfig.name).catch((err) => {
        log(`[${appConfig.name}] Background call failed: ${err.message}`);
      });

      // Send notification
      await sendNotification(appConfig.name);
      
    } catch (e) {
      log(`[${appConfig.name}] ❌ Error processing webhook: ${e.message}`);
      console.error(`[${appConfig.name}] Error stack:`, e.stack);
    }
  });
});

// ---------------- HEALTH CHECK ENDPOINT ----------------
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    apps: facebookApps.map((app) => app.name),
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Facebook Webhook Server is running",
    endpoints: {
      health: "/health",
      webhooks: facebookApps.map(app => `/webhook/${app.name}`)
    },
    apps: facebookApps.map(app => app.name)
  });
});

// ---------------- RUN SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`========================================`);
  console.log(`📋 Webhook endpoints:`);
  facebookApps.forEach(app => {
    console.log(`   GET/POST http://localhost:${PORT}/webhook/${app.name}`);
  });
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`📝 Logs being written to: ${LOG_FILE}`);
  console.log(`========================================\n`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n📴 Server shutting down...');
  process.exit(0);
});