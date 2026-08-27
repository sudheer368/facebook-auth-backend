const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const axios = require("axios");
const { GoogleAuth } = require("google-auth-library");

// ---------------- EXPRESS SETUP ----------------
const app = express();
app.use(bodyParser.json());

console.log("🚀 Starting Facebook Webhook Server...");
console.log(`Environment: ${process.env.NODE_ENV || "development"}`);

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
    accessToken:
      "EAAeYffFPIZC8BSJJ3ohZC9iTfV9ZC6BDgLkLrr5yvOG90GaNpM7u4yQeZCODY8CkA2kiaL5Pl1mG16dZAzFx0mtCHWhKrNO6Wwk3YPrsHB4lg94sYfErZCMC0WTQvxZAlflGTfs8P06WM8s5oVwh3hdZAKPZAHcBSvOZC6jhfmvkaiOf0mLdBWUEAD6NL7qqN9IeXZC",
    verifyToken: "Chinni@143",
    name: "sudheer_demo",
    numberId: "8",
    companyid: "XxzeBoDcqsaB0gApMfySELG6c5a2",
  },
];

console.log(`📋 Loaded ${facebookApps.length} Facebook app(s)`);

// ---------------- FCM ACCESS TOKEN (HTTP v1) ----------------
const serviceAccount = require("./serviceAccountKey.json"); // Make sure this file exists

async function getAccessToken() {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  return accessToken.token;
}

// ---------------- HELPER FUNCTIONS ----------------
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url, {
        timeout: 10000,
        headers: { Accept: "application/json" },
      });
      return res.data;
    } catch (e) {
      if (i === retries) {
        console.error(`❌ Fetch failed after ${retries + 1} attempts:`, e.message);
        throw e;
      }
      console.log(`🔄 Retry ${i + 1}/${retries}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function enrichLeadData(leadId, token) {
  try {
    const leadUrl = `https://graph.facebook.com/v18.0/${leadId}?fields=id,created_time,field_data,form_id,ad_id,adset_id,campaign_id,is_organic&access_token=${token}`;
    const lead = await fetchWithRetry(leadUrl);

    if (!lead || !lead.id) return {};

    let adName = null,
      adsetName = null,
      campaignName = null,
      formName = null;

    if (lead.form_id) {
      try {
        const form = await fetchWithRetry(
          `https://graph.facebook.com/v18.0/${lead.form_id}?fields=name&access_token=${token}`
        );
        formName = form?.name || null;
      } catch (e) {}
    }

    if (lead.ad_id) {
      try {
        const ad = await fetchWithRetry(
          `https://graph.facebook.com/v18.0/${lead.ad_id}?fields=name&access_token=${token}`
        );
        adName = ad?.name || null;
      } catch (e) {}
    }

    if (lead.adset_id) {
      try {
        const adset = await fetchWithRetry(
          `https://graph.facebook.com/v18.0/${lead.adset_id}?fields=name&access_token=${token}`
        );
        adsetName = adset?.name || null;
      } catch (e) {}
    }

    if (lead.campaign_id) {
      try {
        const campaign = await fetchWithRetry(
          `https://graph.facebook.com/v18.0/${lead.campaign_id}?fields=name&access_token=${token}`
        );
        campaignName = campaign?.name || null;
      } catch (e) {}
    }

    return {
      ...lead,
      adName,
      adsetName,
      campaignName,
      formName,
    };
  } catch (error) {
    console.error(`[enrichLeadData] Error:`, error.message);
    return {};
  }
}

// ---------------- NOTIFICATION FUNCTION (FCM v1) ----------------
async function sendNotification(appConfig, appName, leadDetails = null) {
  const notificationUrl = `https://us-central1-kiran-interior-b7e9c.cloudfunctions.net/Interiorleadsnotification/users?companyId=${appConfig.companyid}`;

  const notificationBody = `New Facebook lead from ${appName}`;

  try {
    // 1. Get tokens from your Cloud Function
    const response = await axios.get(notificationUrl, { timeout: 10000 });
    const tokens = response.data.tokens || [];

    if (tokens.length === 0) {
      log(`[${appName}] No tokens found`);
      return;
    }

    log(`[${appName}] Found ${tokens.length} tokens. Sending notifications...`);

    // 2. Get Access Token
    const accessToken = await getAccessToken();

    // 3. Send notification to all tokens
    const results = await Promise.allSettled(
      tokens.map((token) =>
        axios.post(
          "https://fcm.googleapis.com/v1/projects/interior-2f3d9/messages:send",
          {
            message: {
              token: token,
              notification: {
                title: `New Lead from ${appName}`,
                body: notificationBody,
              },
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            timeout: 10000,
          }
        )
      )
    );

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.filter((r) => r.status === "rejected").length;

    log(`[${appName}] Notification → Success: ${successCount}, Failed: ${failCount}`);
  } catch (err) {
    log(`[${appName}] Notification failed: ${err.message}`);
  }
}

// ---------------- CALL NOW FUNCTION ----------------
async function callNow(appConfig, numberId, appName) {
  if (!numberId || numberId === "0" || numberId === "8") {
    log(`[${appName}] ⚠️ No valid numberId, skipping call`);
    return;
  }

  try {
    const callUrl = `https://settingsapi-5xky4wiyxa-uc.a.run.app/get-settings/${appConfig.companyid}/${numberId}`;
    await axios.get(callUrl, { timeout: 10000 });
    log(`[${appName}] 📞 CallNow triggered for ${numberId}`);
  } catch (err) {
    log(`[${appName}] ❌ CallNow failed: ${err.message}`);
  }
}

// ---------------- VOICE AGENT CALL FUNCTION ----------------
async function triggerVoiceCall(phoneNumber, leadData, companyId, leadId) {
  if (!phoneNumber) return;

  try {
    const voicePayload = {
      phoneNumber: phoneNumber,
      agentId: 17561,
      provider: "edesy-ivr",
      variables: {
        customer_name: leadData.name || "Customer",
        lead_id: leadId || "",
        company_id: companyId,
        phone: phoneNumber,
        email: leadData.email || "",
        city: leadData.city || "",
        space_type: leadData.spaceType || "",
        timeline: leadData.timeline || "",
        budget: leadData.budget || "",
        campaign: leadData.campaign || "",
        ad_name: leadData.ad || "",
        form_name: leadData.formName || "",
      },
    };

    await axios.post("https://voice-agent.edesy.in/api/v1/calls/", voicePayload, {
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Bearer vp_live_c80f78081f8cc718882a0626e04fc81e503798e8a150dc5d4979b6dfcc054f65",
      },
      timeout: 15000,
    });

    console.log(`[Voice] ✅ Voice call created for ${phoneNumber}`);
  } catch (err) {
    console.error(`[Voice] ❌ Error:`, err.message);
  }
}

// ---------------- WEBHOOKS ----------------
facebookApps.forEach((appConfig) => {
  console.log(`✅ Setting up webhook for: ${appConfig.name}`);

  // VERIFY
  app.get(`/webhook/${appConfig.name}`, (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === appConfig.verifyToken) {
      log(`[${appConfig.name}] ✅ Webhook verified`);
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  // RECEIVE
  app.post(`/webhook/${appConfig.name}`, async (req, res) => {
    res.sendStatus(200); // Always respond quickly

    try {
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const leadId = value?.leadgen_id || value?.lead_id || entry?.id;

      if (!leadId || leadId.length < 5) {
        log(`[${appConfig.name}] Invalid lead ID`);
        return;
      }

      log(`[${appConfig.name}] Processing lead: ${leadId}`);

      const data = await enrichLeadData(leadId, appConfig.accessToken);
      if (!data || !data.id) {
        log(`[${appConfig.name}] Failed to fetch lead data`);
        return;
      }

      // Extract fields
      const fields = {};
      if (Array.isArray(data.field_data)) {
        data.field_data.forEach((f) => {
          if (f.name) fields[f.name] = f.values?.[0] || "";
        });
      }

      const mappedFields = {
        id: data.id,
        created_time: data.created_time || new Date().toISOString(),
        ad_id: data.ad_id || null,
        ad_name: data.adName || null,
        adset_id: data.adset_id || null,
        adset_name: data.adsetName || null,
        campaign_id: data.campaign_id || null,
        campaign_name: data.campaignName || null,
        form_id: data.form_id || null,
        form_name: data.formName || null,
        is_organic: data.is_organic || null,
        platform: "Facebook",
        email: fields.email || fields.email_address || "",
        full_name: fields.full_name || fields.name || fields.customer_name || "",
        phone_number: fields.phone_number || fields.phone || fields.mobile_number || "",
        city: fields.city || fields.city_name || "",
        post_code: fields.post_code || fields.zip_code || "",
        spaceType:
          fields.what_type_of_space_do_you_need_interior_for_ || fields.space_type || "",
        timeline:
          fields.when_are_you_planning_to_start_the_work_ || fields.timeline || "",
        budget:
          fields.what_is_your_estimated_budget_for_interiors_ || fields.budget || "",
        message: fields.message || "",
      };

      const phoneNumber = mappedFields.phone_number;

      const payload = {
        companyId: appConfig.companyid,
        name: mappedFields.full_name,
        phone: mappedFields.phone_number,
        email: mappedFields.email,
        city: mappedFields.city,
        postCode: mappedFields.post_code,
        spaceType: mappedFields.spaceType,
        timeline: mappedFields.timeline,
        budget: mappedFields.budget,
        source: "Facebook",
        campaign: mappedFields.campaign_name,
        campaignId: mappedFields.campaign_id,
        adSet: mappedFields.adset_name,
        adSetId: mappedFields.adset_id,
        ad: mappedFields.ad_name,
        adId: mappedFields.ad_id,
        formName: mappedFields.form_name,
        formId: mappedFields.form_id,
        leadId: mappedFields.id,
        createdTime: mappedFields.created_time,
        isOrganic: mappedFields.is_organic,
        platform: "Facebook",
        status: "new",
        message: mappedFields.message,
        metaData: {
          ad_id: mappedFields.ad_id,
          ad_name: mappedFields.ad_name,
          adset_id: mappedFields.adset_id,
          adset_name: mappedFields.adset_name,
          campaign_id: mappedFields.campaign_id,
          campaign_name: mappedFields.campaign_name,
          form_id: mappedFields.form_id,
          form_name: mappedFields.form_name,
          facebookAppName: appConfig.name,
        },
      };

      // Save lead
      const apiUrl =
        "https://us-central1-kiran-interior-b7e9c.cloudfunctions.net/interiorhubleads/leads";

      try {
        const response = await axios.post(apiUrl, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        });

        log(`[${appConfig.name}] ✅ Lead saved: ${response.data?.id || "success"}`);

        // Voice call
        if (phoneNumber && phoneNumber.length > 5) {
          await triggerVoiceCall(
            phoneNumber,
            {
              name: payload.name,
              email: payload.email,
              city: payload.city,
              spaceType: payload.spaceType,
              timeline: payload.timeline,
              budget: payload.budget,
              campaign: payload.campaign,
              ad: payload.ad,
              formName: payload.formName,
            },
            appConfig.companyid,
            response.data?.id || ""
          );
        }

        // Send Notification
        await sendNotification(appConfig, appConfig.name, {
          name: mappedFields.full_name,
          phone: mappedFields.phone_number,
          spaceType: mappedFields.spaceType,
        });
      } catch (err) {
        log(`[${appConfig.name}] ❌ API save failed: ${err.message}`);
      }

      // Call Now
      callNow(appConfig, appConfig.numberId, appConfig.name).catch(() => {});
    } catch (e) {
      log(`[${appConfig.name}] ❌ Error: ${e.message}`);
    }
  });
});

// ---------------- HEALTH CHECK ----------------
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    apps: facebookApps.map((a) => a.name),
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Facebook Webhook Server is running",
    endpoints: facebookApps.map((a) => `/webhook/${a.name}`),
  });
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`Webhook: /webhook/${facebookApps[0].name}\n`);
});