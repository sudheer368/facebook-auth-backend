const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const axios = require("axios");

// ---------------- EXPRESS SETUP ----------------
const app = express();
app.use(bodyParser.json());

console.log("🚀 Starting Facebook Webhook Server...");
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

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
    companyid: "XxzeBoDcqsaB0gApMfySELG6c5a2",
  },
];

console.log(`📋 Loaded ${facebookApps.length} Facebook app(s)`);

// ---------------- HELPER FUNCTIONS ----------------
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
        }
      });
      return res.data;
    } catch (e) {
      if (i === retries) {
        console.error(`❌ Fetch failed after ${retries + 1} attempts:`, e.message);
        if (e.response) {
          console.error(`Status: ${e.response.status}`);
          console.error(`Data:`, JSON.stringify(e.response.data, null, 2));
        }
        throw e;
      }
      console.log(`🔄 Retry ${i + 1}/${retries} for URL: ${url.substring(0, 100)}...`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function enrichLeadData(leadId, token) {
  try {
    console.log(`[enrichLeadData] Fetching lead: ${leadId}`);
    
    const leadUrl = `https://graph.facebook.com/v18.0/${leadId}?fields=id,created_time,field_data,form_id,ad_id,adset_id,campaign_id,is_organic&access_token=${token}`;
    const lead = await fetchWithRetry(leadUrl);
    
    if (!lead || !lead.id) {
      console.error(`[enrichLeadData] Invalid lead data for ${leadId}`);
      return {};
    }

    console.log(`[enrichLeadData] Successfully fetched lead: ${lead.id}`);

    let adName = null;
    let adsetName = null;
    let campaignName = null;
    let formName = null;

    // Fetch form name if available
    if (lead.form_id) {
      try {
        const form = await fetchWithRetry(
          `https://graph.facebook.com/v18.0/${lead.form_id}?fields=name&access_token=${token}`
        );
        formName = form?.name || null;
        console.log(`[enrichLeadData] Form name: ${formName}`);
      } catch (err) {
        console.error(`[enrichLeadData] Error fetching form: ${err.message}`);
      }
    }

    // Fetch ad name if available
    if (lead.ad_id) {
      try {
        const ad = await fetchWithRetry(
          `https://graph.facebook.com/v18.0/${lead.ad_id}?fields=name&access_token=${token}`
        );
        adName = ad?.name || null;
        console.log(`[enrichLeadData] Ad name: ${adName}`);
      } catch (err) {
        console.error(`[enrichLeadData] Error fetching ad: ${err.message}`);
      }
    }

    // Fetch adset name if available
    if (lead.adset_id) {
      try {
        const adset = await fetchWithRetry(
          `https://graph.facebook.com/v18.0/${lead.adset_id}?fields=name&access_token=${token}`
        );
        adsetName = adset?.name || null;
        console.log(`[enrichLeadData] Adset name: ${adsetName}`);
      } catch (err) {
        console.error(`[enrichLeadData] Error fetching adset: ${err.message}`);
      }
    }

    // Fetch campaign name if available
    if (lead.campaign_id) {
      try {
        const campaign = await fetchWithRetry(
          `https://graph.facebook.com/v18.0/${lead.campaign_id}?fields=name&access_token=${token}`
        );
        campaignName = campaign?.name || null;
        console.log(`[enrichLeadData] Campaign name: ${campaignName}`);
      } catch (err) {
        console.error(`[enrichLeadData] Error fetching campaign: ${err.message}`);
      }
    }

    const enrichedData = {
      ...lead,
      adName,
      adsetName,
      campaignName,
      formName
    };

    console.log(`[enrichLeadData] Enriched data for lead: ${leadId}`);
    return enrichedData;

  } catch (error) {
    console.error(`[enrichLeadData] Critical error for lead ${leadId}:`, error.message);
    if (error.response) {
      console.error(`Facebook API Status: ${error.response.status}`);
      console.error(`Facebook API Data:`, JSON.stringify(error.response.data, null, 2));
    }
    return {};
  }
}

// ---------------- NOTIFICATION FUNCTION ----------------
async function sendNotification(appConfig, leadDetails = null) {  // Accepts appConfig object
  const notificationUrl = "https://us-central1-kiran-interior-b7e9c.cloudfunctions.net/Interiorleadsnotification/send-notification";
  
  // Use appConfig directly (not a string)
  const companyId = appConfig.companyid;
  const appName = appConfig.name;
  
  // Build notification title and message
  const title = `New Lead from ${appName}`;
  let message = `New Facebook lead from ${appName}`;
  
  if (leadDetails) {
    if (leadDetails.name) message += `\n👤 Name: ${leadDetails.name}`;
    if (leadDetails.phone) message += `\n📱 Phone: ${leadDetails.phone}`;
    if (leadDetails.spaceType) message += `\n🏠 Space: ${leadDetails.spaceType}`;
  }
  
  // Build the complete payload with companyId
  const payload = {
    companyId: companyId,  // This is now included
    title: title,
    message: message,
    timestamp: new Date().toISOString(),
    appName: appName,
    leadDetails: leadDetails || {}
  };
  
  console.log(`[${appName}] 📨 Sending notification payload:`, JSON.stringify(payload, null, 2));
  
  try {
    const response = await axios.post(notificationUrl, payload, { 
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      }
    });
    console.log(`[${appName}] ✅ Notification sent successfully`);
    console.log(`[${appName}] Notification response:`, JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (err) {
    console.error(`[${appName}] ❌ Notification failed: ${err.message}`);
    if (err.response) {
      console.error(`[${appName}] Response status: ${err.response.status}`);
      console.error(`[${appName}] Response data:`, JSON.stringify(err.response.data, null, 2));
    }
    return null;
  }
}


// ---------------- CALL NOW FUNCTION ----------------
async function callNow(numberId, appName) {
  if (!numberId || numberId === "0" || numberId === "8") {
    log(`[${appName}] ⚠️ No valid numberId provided, skipping call`);
    return;
  }

  try {
    const callUrl = `https://settingsapi-5xky4wiyxa-uc.a.run.app/get-settings/${appConfig.companyid}/${numberId}`;
    const response = await axios.get(callUrl, { timeout: 10000 });
    log(`[${appName}] 📞 CallNow triggered successfully for ${numberId}`);
    return response.data;
  } catch (err) {
    log(`[${appName}] ❌ CallNow failed for ${numberId}: ${err.message}`);
    return null;
  }
}

// ---------------- VOICE AGENT CALL FUNCTION ----------------
async function triggerVoiceCall(phoneNumber, leadData, companyId, leadId) {
  if (!phoneNumber) {
    console.log(`[Voice] ⚠️ No phone number provided, skipping voice call`);
    return;
  }

  try {
    console.log(`[Voice] 📞 Initiating voice call to ${phoneNumber}`);
    
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

    const voiceResponse = await axios.post(
      "https://voice-agent.edesy.in/api/v1/calls/",
      voicePayload,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer vp_live_c80f78081f8cc718882a0626e04fc81e503798e8a150dc5d4979b6dfcc054f65",
        },
        timeout: 15000,
      }
    );

    console.log(`[Voice] ✅ Voice call created successfully for ${phoneNumber}`);
    console.log(`[Voice] Response:`, JSON.stringify(voiceResponse.data, null, 2));
    return voiceResponse.data;
  } catch (err) {
    console.error(`[Voice] ❌ Voice API Error:`, err.message);
    if (err.response) {
      console.error(`[Voice] Status: ${err.response.status}`);
      console.error(`[Voice] Data:`, JSON.stringify(err.response.data, null, 2));
    }
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
    console.log(`[${appConfig.name}] Request headers:`, req.headers);
    console.log(`[${appConfig.name}] Request body preview:`, JSON.stringify(req.body, null, 2));
    
    // Immediately return 200 to acknowledge receipt
    res.sendStatus(200);

    try {
      // Extract lead ID from various possible locations in the payload
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const leadId = value?.leadgen_id || value?.lead_id || entry?.id;

      if (!leadId) {
        log(`[${appConfig.name}] No lead ID found in request`);
        console.log(`[${appConfig.name}] Full request body:`, JSON.stringify(req.body, null, 2));
        return;
      }

      // Validate lead ID format - Facebook lead IDs are typically long numbers
      if (!leadId || leadId.length < 5) {
        log(`[${appConfig.name}] ⚠️ Invalid lead ID format: ${leadId}`);
        return;
      }

      log(`[${appConfig.name}] Processing lead: ${leadId}`);

      // Fetch and enrich lead data
      const data = await enrichLeadData(leadId, appConfig.accessToken);

      if (!data || !data.id) {
        log(`[${appConfig.name}] ❌ Failed to fetch valid lead data for ID: ${leadId}`);
        console.log(`[${appConfig.name}] Enriched data result:`, JSON.stringify(data, null, 2));
        return;
      }

      log(`[${appConfig.name}] ✅ Successfully fetched lead data for: ${data.id}`);

      // Extract field data from Facebook response
      const fields = {};
      if (Array.isArray(data.field_data)) {
        data.field_data.forEach((f) => {
          if (f.name) fields[f.name] = f.values?.[0] || "";
        });
      }

      console.log(`[${appConfig.name}] Extracted fields:`, Object.keys(fields));

      // Map all fields with proper naming
      const mappedFields = {
        // Basic fields
        id: data.id,
        created_time: data.created_time || new Date().toISOString(),
        
        // Facebook Ad Campaign fields
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
        
        // Contact Information
        email: fields.email || fields.email_address || "",
        full_name: fields.full_name || fields.name || fields.customer_name || "",
        phone_number: fields.phone_number || fields.phone || fields.mobile_number || "",
        phone_number_verified: fields.phone_number_verified || "false",
        
        // Location
        city: fields.city || fields.city_name || "",
        post_code: fields.post_code || fields.zip_code || fields.postal_code || "",
        
        // Interior Design Specific Fields
        what_type_of_space_do_you_need_interior_for_: fields.what_type_of_space_do_you_need_interior_for_ || fields.space_type || "",
        when_are_you_planning_to_start_the_work_: fields.when_are_you_planning_to_start_the_work_ || fields.start_time || fields.timeline || "",
        what_is_your_estimated_budget_for_interiors_: fields.what_is_your_estimated_budget_for_interiors_ || fields.budget || fields.estimated_budget || "",
        
        // Additional fields
        message: fields.message || fields.comments || fields.additional_info || "",
        source: "Facebook",
        status: "new",
        
        // Store all fields as raw data
        all_fields: fields
      };

      // Get phone number for voice call
      const phoneNumber = mappedFields.phone_number;

      // Prepare payload for the API
      const payload = {
        companyId: appConfig.companyid,
        
        // Contact Information
        name: mappedFields.full_name,
        phone: mappedFields.phone_number,
        email: mappedFields.email,
        
        // Location
        city: mappedFields.city,
        postCode: mappedFields.post_code,
        
        // Interior Design Specific Fields
        spaceType: mappedFields.what_type_of_space_do_you_need_interior_for_,
        timeline: mappedFields.when_are_you_planning_to_start_the_work_,
        budget: mappedFields.what_is_your_estimated_budget_for_interiors_,
        
        // Facebook Campaign Details
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
        platform: mappedFields.platform,
        phoneVerified: mappedFields.phone_number_verified,
        
        // Status
        status: "new",
        
        // Message
        message: mappedFields.message,
        
        // Complete metadata
        metaData: {
          ad_id: mappedFields.ad_id,
          ad_name: mappedFields.ad_name,
          adset_id: mappedFields.adset_id,
          adset_name: mappedFields.adset_name,
          campaign_id: mappedFields.campaign_id,
          campaign_name: mappedFields.campaign_name,
          form_id: mappedFields.form_id,
          form_name: mappedFields.form_name,
          is_organic: mappedFields.is_organic,
          facebookAppName: appConfig.name,
          phone_number_verified: mappedFields.phone_number_verified,
          city: mappedFields.city,
          post_code: mappedFields.post_code,
          space_type: mappedFields.what_type_of_space_do_you_need_interior_for_,
          timeline: mappedFields.when_are_you_planning_to_start_the_work_,
          budget: mappedFields.what_is_your_estimated_budget_for_interiors_,
          all_fields: mappedFields.all_fields
        }
      };

      console.log(`[${appConfig.name}] 📤 Sending payload to Interior Hub API`);

      // Save to Interior Hub API
      const apiUrl = "https://us-central1-kiran-interior-b7e9c.cloudfunctions.net/interiorhubleads/leads";

      try {
        const response = await axios.post(apiUrl, payload, {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 15000,
        });

        const responseData = response.data;
        log(`[${appConfig.name}] ✅ Lead saved to Interior Hub API: ${responseData?.id || "success"}`);
        console.log(`[${appConfig.name}] API Response:`, JSON.stringify(responseData, null, 2));

        // Trigger voice call if phone number exists
        if (phoneNumber && phoneNumber.length > 5) {
          console.log(`[${appConfig.name}] 📞 Triggering voice call for ${phoneNumber}`);
          
          const voiceResult = await triggerVoiceCall(
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
              formName: payload.formName
            },
            appConfig.companyid,
            responseData?.id || ""
          );

          if (voiceResult) {
            log(`[${appConfig.name}] ✅ Voice call successful for ${phoneNumber}`);
          } else {
            log(`[${appConfig.name}] ⚠️ Voice call failed for ${phoneNumber}`);
          }
        } else {
          log(`[${appConfig.name}] ⚠️ No valid phone number found, skipping voice call`);
        }

        // Send notification
        await sendNotification(appConfig.name, {
          name: mappedFields.full_name,
          phone: mappedFields.phone_number,
          spaceType: mappedFields.what_type_of_space_do_you_need_interior_for_
        });

      } catch (err) {
        log(`[${appConfig.name}] ❌ API save failed: ${err.message}`);
        if (err.response) {
          console.error(`[${appConfig.name}] API Status: ${err.response.status}`);
          console.error(`[${appConfig.name}] API Data:`, JSON.stringify(err.response.data, null, 2));
        }
        // Don't return here - allow notification to still be sent
      }

      // Trigger call now (don't await)
      callNow(appConfig.numberId, appConfig.name).catch((err) => {
        log(`[${appConfig.name}] Background call failed: ${err.message}`);
      });

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
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Facebook Webhook Server is running",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      webhooks: facebookApps.map(app => `/webhook/${app.name}`)
    },
    apps: facebookApps.map(app => ({
      name: app.name,
      companyId: app.companyid,
      webhookUrl: `/webhook/${app.name}`
    })),
    timestamp: new Date().toISOString()
  });
});

// ---------------- ERROR HANDLING MIDDLEWARE ----------------
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// ---------------- RUN SERVER ----------------
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`========================================`);
  console.log(`📋 Webhook endpoints:`);
  facebookApps.forEach(app => {
    console.log(`   GET/POST /webhook/${app.name}`);
  });
  console.log(`✅ Health check: /health`);
  console.log(`📝 Logs being written to: ${LOG_FILE}`);
  console.log(`========================================`);
  console.log(`📍 Server URL: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: https://your-domain.com/webhook/${facebookApps[0].name}`);
  console.log(`========================================\n`);
});

// ---------------- GRACEFUL SHUTDOWN ----------------
process.on('SIGTERM', () => {
  console.log('📴 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('📴 Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n📴 Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('📴 Server closed');
    process.exit(0);
  });
});

// ---------------- UNHANDLED REJECTION HANDLER ----------------
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});