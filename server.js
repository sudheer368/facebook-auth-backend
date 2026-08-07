const express = require("express");
const session = require("express-session");
const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const cors = require("cors");

const app = express();

// ============ CONFIGURATION ============
const CONFIG = {
  PORT: process.env.PORT || 4400,
  FACEBOOK_APP_ID: "1012373291541065",
  FACEBOOK_APP_SECRET: "9d3b82a3d291a386d7b10c30a1fcb010",
  CALLBACK_URL: "https://facebook-auth-backend-1.onrender.com/auth/facebook/callback",
  CLIENT_URL: "*",
  SESSION_SECRET: "9d3b82a3d291a386d7b10c30a1fcb010",
  ENVIRONMENT: "production"
};
// ======================================

// ============ LOGGING UTILITY ============
const log = {
  info: (message, data = {}) => {
    console.log(`[${new Date().toISOString()}] ℹ️ ${message}`, data);
  },
  success: (message, data = {}) => {
    console.log(`[${new Date().toISOString()}] ✅ ${message}`, data);
  },
  error: (message, data = {}) => {
    console.error(`[${new Date().toISOString()}] ❌ ${message}`, data);
  },
  warn: (message, data = {}) => {
    console.warn(`[${new Date().toISOString()}] ⚠️ ${message}`, data);
  },
  auth: (message, data = {}) => {
    console.log(`[${new Date().toISOString()}] 🔐 ${message}`, data);
  },
  request: (req) => {
    console.log(`[${new Date().toISOString()}] 📨 ${req.method} ${req.url} - IP: ${req.ip}`);
  },
  lead: (message, data = {}) => {
    console.log(`[${new Date().toISOString()}] 👤 ${message}`, data);
  },
  ad: (message, data = {}) => {
    console.log(`[${new Date().toISOString()}] 📢 ${message}`, data);
  }
};

// ============ TRACK USED CODES ============
const usedCodes = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [code, timestamp] of usedCodes.entries()) {
    if (now - timestamp > 5 * 60 * 1000) {
      usedCodes.delete(code);
    }
  }
}, 60000);

// ============ LEAD STORAGE ============
const leadsDB = [];
const requestsDB = [];
const adsDB = [];

// ============ MIDDLEWARE ============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({ 
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    callback(null, true);
  }, 
  credentials: true 
}));

app.use((req, res, next) => {
  log.request(req);
  next();
});

const isAuthenticated = (req, res, next) => {
  if (!req.isAuthenticated()) {
    log.warn("Unauthorized access attempt", {
      sessionId: req.sessionID || "No session",
      ip: req.ip,
      url: req.url
    });
    
    return res.status(401).json({
      success: false,
      message: "Authentication required. Please login first.",
      timestamp: new Date().toISOString()
    });
  }
  next();
};

// ============ SESSION CONFIGURATION ============
app.use(
  session({ 
    secret: CONFIG.SESSION_SECRET, 
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ============ PASSPORT CONFIGURATION ============
passport.serializeUser((user, done) => {
  log.info("Serializing user", { 
    id: user.id, 
    displayName: user.displayName 
  });
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  log.info("Deserializing user", { 
    id: obj.id, 
    displayName: obj.displayName 
  });
  done(null, obj);
});

// Facebook Strategy with ONLY valid default permissions
passport.use(
  new FacebookStrategy(
    {
      clientID: CONFIG.FACEBOOK_APP_ID,
      clientSecret: CONFIG.FACEBOOK_APP_SECRET,
      callbackURL: CONFIG.CALLBACK_URL,
      profileFields: [
        "id", 
        "displayName", 
        "emails", 
        "picture.type(large)",
        "name"
      ],
      state: true,
      passReqToCallback: true
    },
    (req, accessToken, refreshToken, profile, done) => {
      log.auth("Facebook authentication received", {
        displayName: profile.displayName,
        id: profile.id,
        email: profile.emails?.[0]?.value || "No email provided",
        sessionId: req.sessionID || "No session"
      });

      if (req.session && req.session.usedAuthCode) {
        log.warn("Duplicate auth attempt detected, rejecting...", {
          sessionId: req.sessionID
        });
        return done(null, false, { message: "Authorization code already used" });
      }
      
      req.session.facebookAccessToken = accessToken;
      
      if (req.session) {
        req.session.usedAuthCode = true;
        req.session.userProfile = profile;
      }

      log.success("User authenticated successfully", {
        displayName: profile.displayName,
        userId: profile.id
      });

      return done(null, profile);
    }
  )
);

// ============ ROUTES ============

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "Server is running",
    environment: CONFIG.ENVIRONMENT,
    authenticated: req.isAuthenticated() || false,
    sessionId: req.sessionID || "No session",
    timestamp: new Date().toISOString(),
    endpoints: [
      "GET / - Health check",
      "GET /auth/facebook - Initiate Facebook login",
      "GET /auth/facebook/callback - Facebook OAuth callback",
      "GET /status - Server status",
      "GET /profile - Get authenticated user",
      "GET /logout - Logout user",
      "GET /auth/reset-session - Reset session",
      "=== LEAD MANAGEMENT ===",
      "POST /leads - Create a new lead",
      "GET /leads - Get all leads",
      "GET /leads/:id - Get a specific lead",
      "PUT /leads/:id - Update a lead",
      "DELETE /leads/:id - Delete a lead",
      "=== REQUEST MANAGEMENT ===",
      "POST /requests - Create a new request",
      "GET /requests - Get all requests",
      "GET /requests/:id - Get a specific request",
      "PUT /requests/:id - Update a request",
      "DELETE /requests/:id - Delete a request",
      "=== AD MANAGEMENT ===",
      "POST /ads - Create a new ad",
      "GET /ads - Get all ads",
      "GET /ads/:id - Get a specific ad",
      "PUT /ads/:id - Update an ad",
      "DELETE /ads/:id - Delete an ad"
    ]
  });
});

// Initiate Facebook login with ONLY valid default permissions
app.get("/auth/facebook", (req, res, next) => {
  log.auth("Initiating Facebook login with default permissions", {
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    sessionId: req.sessionID || "No session"
  });
  
  req.session.loginInitiated = Date.now();
  
  passport.authenticate("facebook", { 
    scope: [
      "email",
      "public_profile"
      // Only default permissions that work without App Review
    ]
  })(req, res, next);
});

// Facebook OAuth callback
app.get(
  "/auth/facebook/callback",
  (req, res, next) => {
    const code = req.query.code;
    
    log.auth("Facebook callback received", {
      hasCode: !!code,
      hasState: !!req.query.state,
      sessionId: req.sessionID || "No session",
      hasCookies: !!req.headers.cookie
    });
    
    if (code && usedCodes.has(code)) {
      log.warn("Duplicate authorization code detected globally", { 
        code: code.substring(0, 20) + '...' 
      });
      return res.status(400).json({
        success: false,
        message: "This authorization code has already been used. Please try again.",
        timestamp: new Date().toISOString()
      });
    }
    
    if (code) {
      usedCodes.set(code, Date.now());
    }
    
    if (req.session && req.session.usedAuthCode) {
      log.warn("Session already used an auth code", {
        sessionId: req.sessionID
      });
      return res.redirect("/login-failed?reason=code_already_used");
    }
    
    next();
  },
  passport.authenticate("facebook", { 
    failureRedirect: "/login-failed",
    failureMessage: true
  }),
  (req, res) => {
    log.success("Authentication successful", {
      user: {
        id: req.user.id,
        displayName: req.user.displayName,
        email: req.user.emails?.[0]?.value || null
      },
      sessionId: req.sessionID
    });

    req.session.usedAuthCode = true;
    
    res.json({
      success: true,
      message: "Authentication successful",
      user: {
        id: req.user.id,
        displayName: req.user.displayName,
        email: req.user.emails?.[0]?.value || null,
        picture: req.user.photos?.[0]?.value || null,
        provider: req.user.provider
      },
      timestamp: new Date().toISOString()
    });
  }
);

// ============ LEAD MANAGEMENT ============

app.post("/leads", isAuthenticated, (req, res) => {
  log.lead("Creating new lead", {
    user: req.user.displayName,
    userId: req.user.id
  });

  const { name, email, phone, source, status, notes } = req.body;
  
  if (!name || !email) {
    return res.status(400).json({
      success: false,
      message: "Name and email are required fields"
    });
  }

  const newLead = {
    id: Date.now().toString(),
    name,
    email,
    phone: phone || "",
    source: source || "website",
    status: status || "new",
    notes: notes || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: {
      id: req.user.id,
      displayName: req.user.displayName
    }
  };

  leadsDB.push(newLead);
  
  log.success("Lead created successfully", { leadId: newLead.id });
  
  res.status(201).json({
    success: true,
    message: "Lead created successfully",
    data: newLead,
    timestamp: new Date().toISOString()
  });
});

app.get("/leads", isAuthenticated, (req, res) => {
  log.lead("Fetching all leads", {
    user: req.user.displayName,
    totalLeads: leadsDB.length
  });

  res.json({
    success: true,
    total: leadsDB.length,
    data: leadsDB,
    timestamp: new Date().toISOString()
  });
});

app.get("/leads/:id", isAuthenticated, (req, res) => {
  const lead = leadsDB.find(l => l.id === req.params.id);
  
  if (!lead) {
    return res.status(404).json({
      success: false,
      message: "Lead not found",
      timestamp: new Date().toISOString()
    });
  }

  res.json({
    success: true,
    data: lead,
    timestamp: new Date().toISOString()
  });
});

app.put("/leads/:id", isAuthenticated, (req, res) => {
  const leadIndex = leadsDB.findIndex(l => l.id === req.params.id);
  
  if (leadIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Lead not found",
      timestamp: new Date().toISOString()
    });
  }

  const { name, email, phone, source, status, notes } = req.body;
  
  leadsDB[leadIndex] = {
    ...leadsDB[leadIndex],
    name: name || leadsDB[leadIndex].name,
    email: email || leadsDB[leadIndex].email,
    phone: phone || leadsDB[leadIndex].phone,
    source: source || leadsDB[leadIndex].source,
    status: status || leadsDB[leadIndex].status,
    notes: notes || leadsDB[leadIndex].notes,
    updatedAt: new Date().toISOString()
  };

  res.json({
    success: true,
    message: "Lead updated successfully",
    data: leadsDB[leadIndex],
    timestamp: new Date().toISOString()
  });
});

app.delete("/leads/:id", isAuthenticated, (req, res) => {
  const leadIndex = leadsDB.findIndex(l => l.id === req.params.id);
  
  if (leadIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Lead not found",
      timestamp: new Date().toISOString()
    });
  }

  const deletedLead = leadsDB[leadIndex];
  leadsDB.splice(leadIndex, 1);

  res.json({
    success: true,
    message: "Lead deleted successfully",
    data: deletedLead,
    timestamp: new Date().toISOString()
  });
});

// ============ REQUEST MANAGEMENT ============

app.post("/requests", isAuthenticated, (req, res) => {
  const { title, description, priority, type, assignedTo } = req.body;
  
  if (!title || !description) {
    return res.status(400).json({
      success: false,
      message: "Title and description are required fields"
    });
  }

  const newRequest = {
    id: Date.now().toString(),
    title,
    description,
    priority: priority || "medium",
    type: type || "general",
    status: "open",
    assignedTo: assignedTo || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: {
      id: req.user.id,
      displayName: req.user.displayName
    }
  };

  requestsDB.push(newRequest);

  res.status(201).json({
    success: true,
    message: "Request created successfully",
    data: newRequest,
    timestamp: new Date().toISOString()
  });
});

app.get("/requests", isAuthenticated, (req, res) => {
  const { status, priority, type } = req.query;
  let filteredRequests = requestsDB;

  if (status) {
    filteredRequests = filteredRequests.filter(r => r.status === status);
  }
  if (priority) {
    filteredRequests = filteredRequests.filter(r => r.priority === priority);
  }
  if (type) {
    filteredRequests = filteredRequests.filter(r => r.type === type);
  }

  res.json({
    success: true,
    total: filteredRequests.length,
    filters: { status, priority, type },
    data: filteredRequests,
    timestamp: new Date().toISOString()
  });
});

app.get("/requests/:id", isAuthenticated, (req, res) => {
  const request = requestsDB.find(r => r.id === req.params.id);
  
  if (!request) {
    return res.status(404).json({
      success: false,
      message: "Request not found"
    });
  }

  res.json({
    success: true,
    data: request,
    timestamp: new Date().toISOString()
  });
});

app.put("/requests/:id", isAuthenticated, (req, res) => {
  const requestIndex = requestsDB.findIndex(r => r.id === req.params.id);
  
  if (requestIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Request not found"
    });
  }

  const { title, description, priority, type, status, assignedTo } = req.body;
  
  requestsDB[requestIndex] = {
    ...requestsDB[requestIndex],
    title: title || requestsDB[requestIndex].title,
    description: description || requestsDB[requestIndex].description,
    priority: priority || requestsDB[requestIndex].priority,
    type: type || requestsDB[requestIndex].type,
    status: status || requestsDB[requestIndex].status,
    assignedTo: assignedTo !== undefined ? assignedTo : requestsDB[requestIndex].assignedTo,
    updatedAt: new Date().toISOString()
  };

  res.json({
    success: true,
    message: "Request updated successfully",
    data: requestsDB[requestIndex],
    timestamp: new Date().toISOString()
  });
});

app.delete("/requests/:id", isAuthenticated, (req, res) => {
  const requestIndex = requestsDB.findIndex(r => r.id === req.params.id);
  
  if (requestIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Request not found"
    });
  }

  const deletedRequest = requestsDB[requestIndex];
  requestsDB.splice(requestIndex, 1);

  res.json({
    success: true,
    message: "Request deleted successfully",
    data: deletedRequest,
    timestamp: new Date().toISOString()
  });
});

// ============ AD MANAGEMENT ============

app.post("/ads", isAuthenticated, (req, res) => {
  const { 
    name, 
    description, 
    platform, 
    budget, 
    startDate, 
    endDate, 
    targetAudience,
    status 
  } = req.body;
  
  if (!name || !budget) {
    return res.status(400).json({
      success: false,
      message: "Name and budget are required fields"
    });
  }

  const newAd = {
    id: Date.now().toString(),
    name,
    description: description || "",
    platform: platform || "facebook",
    budget: parseFloat(budget),
    startDate: startDate || new Date().toISOString(),
    endDate: endDate || null,
    targetAudience: targetAudience || {},
    status: status || "draft",
    analytics: {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      spend: 0
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: {
      id: req.user.id,
      displayName: req.user.displayName
    }
  };

  adsDB.push(newAd);

  res.status(201).json({
    success: true,
    message: "Ad created successfully",
    data: newAd,
    timestamp: new Date().toISOString()
  });
});

app.get("/ads", isAuthenticated, (req, res) => {
  const { platform, status } = req.query;
  let filteredAds = adsDB;

  if (platform) {
    filteredAds = filteredAds.filter(a => a.platform === platform);
  }
  if (status) {
    filteredAds = filteredAds.filter(a => a.status === status);
  }

  const totalBudget = filteredAds.reduce((sum, ad) => sum + ad.budget, 0);
  const totalSpend = filteredAds.reduce((sum, ad) => sum + (ad.analytics?.spend || 0), 0);
  const totalImpressions = filteredAds.reduce((sum, ad) => sum + (ad.analytics?.impressions || 0), 0);
  const totalClicks = filteredAds.reduce((sum, ad) => sum + (ad.analytics?.clicks || 0), 0);

  res.json({
    success: true,
    total: filteredAds.length,
    summary: {
      totalBudget,
      totalSpend,
      totalImpressions,
      totalClicks,
      avgCTR: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + '%' : '0%'
    },
    filters: { platform, status },
    data: filteredAds,
    timestamp: new Date().toISOString()
  });
});

app.get("/ads/:id", isAuthenticated, (req, res) => {
  const ad = adsDB.find(a => a.id === req.params.id);
  
  if (!ad) {
    return res.status(404).json({
      success: false,
      message: "Ad not found"
    });
  }

  res.json({
    success: true,
    data: ad,
    timestamp: new Date().toISOString()
  });
});

app.put("/ads/:id", isAuthenticated, (req, res) => {
  const adIndex = adsDB.findIndex(a => a.id === req.params.id);
  
  if (adIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Ad not found"
    });
  }

  const { 
    name, 
    description, 
    platform, 
    budget, 
    startDate, 
    endDate, 
    targetAudience,
    status,
    analytics
  } = req.body;
  
  adsDB[adIndex] = {
    ...adsDB[adIndex],
    name: name || adsDB[adIndex].name,
    description: description !== undefined ? description : adsDB[adIndex].description,
    platform: platform || adsDB[adIndex].platform,
    budget: budget ? parseFloat(budget) : adsDB[adIndex].budget,
    startDate: startDate || adsDB[adIndex].startDate,
    endDate: endDate !== undefined ? endDate : adsDB[adIndex].endDate,
    targetAudience: targetAudience || adsDB[adIndex].targetAudience,
    status: status || adsDB[adIndex].status,
    analytics: analytics ? { ...adsDB[adIndex].analytics, ...analytics } : adsDB[adIndex].analytics,
    updatedAt: new Date().toISOString()
  };

  res.json({
    success: true,
    message: "Ad updated successfully",
    data: adsDB[adIndex],
    timestamp: new Date().toISOString()
  });
});

app.delete("/ads/:id", isAuthenticated, (req, res) => {
  const adIndex = adsDB.findIndex(a => a.id === req.params.id);
  
  if (adIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Ad not found"
    });
  }

  const deletedAd = adsDB[adIndex];
  adsDB.splice(adIndex, 1);

  res.json({
    success: true,
    message: "Ad deleted successfully",
    data: deletedAd,
    timestamp: new Date().toISOString()
  });
});

// ============ UTILITY ROUTES ============

app.get("/auth/reset-session", (req, res) => {
  log.info("Session reset requested", {
    sessionId: req.sessionID || "No session"
  });
  
  req.session.destroy((err) => {
    if (err) {
      log.error("Session reset failed", { error: err.message });
      return res.status(500).json({ 
        success: false, 
        message: "Failed to reset session" 
      });
    }
    log.success("Session reset successful");
    res.json({ 
      success: true, 
      message: "Session reset successfully",
      timestamp: new Date().toISOString()
    });
  });
});

app.get("/login-failed", (req, res) => {
  const error = req.session.messages ? req.session.messages[0] : "Authentication failed";
  const reason = req.query.reason || "unknown";
  
  log.error("Login failed", {
    error: error,
    reason: reason,
    sessionId: req.sessionID || "No session",
    timestamp: new Date().toISOString()
  });
  
  res.status(401).json({
    success: false,
    message: "Authentication failed",
    error: error,
    reason: reason,
    timestamp: new Date().toISOString(),
    hint: "Visit /auth/reset-session to clear your session and try again"
  });
});

app.get("/status", (req, res) => {
  const status = { 
    status: "Server is running", 
    authenticated: req.isAuthenticated() || false,
    environment: CONFIG.ENVIRONMENT,
    timestamp: new Date().toISOString(),
    sessionId: req.sessionID || "No session",
    uptime: Math.floor(process.uptime()),
    stats: {
      usedCodesCount: usedCodes.size,
      totalLeads: leadsDB.length,
      totalRequests: requestsDB.length,
      totalAds: adsDB.length
    }
  };
  
  res.json(status);
});

app.get("/profile", isAuthenticated, (req, res) => {
  log.info("Profile accessed", {
    userId: req.user.id,
    displayName: req.user.displayName,
    sessionId: req.sessionID
  });
  
  res.json({
    success: true,
    user: {
      id: req.user.id,
      displayName: req.user.displayName,
      email: req.user.emails?.[0]?.value || null,
      picture: req.user.photos?.[0]?.value || null,
      provider: req.user.provider
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/logout", (req, res) => {
  log.info("Logout requested", {
    user: req.user?.displayName || "Unknown",
    userId: req.user?.id || "Unknown",
    sessionId: req.sessionID
  });
  
  req.logout((err) => {
    if (err) {
      log.error("Logout failed", { error: err.message });
      return res.status(500).json({ 
        success: false, 
        message: "Logout failed" 
      });
    }
    
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        log.warn("Session destroy after logout failed", { error: destroyErr.message });
      }
      log.success("Logout successful");
      res.json({ 
        success: true, 
        message: "Logged out successfully",
        timestamp: new Date().toISOString()
      });
    });
  });
});

// ============ ERROR HANDLING ============

app.use((req, res) => {
  log.warn("Route not found", {
    method: req.method,
    url: req.url,
    ip: req.ip
  });
  
  res.status(404).json({
    success: false,
    message: "Route not found",
    timestamp: new Date().toISOString()
  });
});

app.use((err, req, res, next) => {
  log.error("Global error", {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  if (err.message && err.message.includes("authorization code")) {
    return res.status(400).json({
      success: false,
      message: "Authorization code already used. Please try again.",
      hint: "Visit /auth/reset-session to reset your session",
      timestamp: new Date().toISOString()
    });
  }
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    timestamp: new Date().toISOString()
  });
});

// ============ START SERVER ============
app.listen(CONFIG.PORT, () => {
  console.log("=".repeat(60));
  console.log(`[${new Date().toISOString()}] 🚀 Facebook Authentication Server Started`);
  console.log("=".repeat(60));
  console.log(`📡 Server running on port: ${CONFIG.PORT}`);
  console.log(`🌐 Environment: ${CONFIG.ENVIRONMENT}`);
  console.log(`🔄 Callback URL: ${CONFIG.CALLBACK_URL}`);
  console.log(`🔑 Facebook App ID: ${CONFIG.FACEBOOK_APP_ID}`);
  console.log(`📋 Permissions: email, public_profile (default)`);
  console.log(`👤 Lead Management: Enabled`);
  console.log(`📋 Request Management: Enabled`);
  console.log(`📢 Ad Management: Enabled`);
  console.log("=".repeat(60));
  console.log(`[${new Date().toISOString()}] ✅ Server is ready to handle requests`);
  console.log("=".repeat(60));
});

process.on("SIGTERM", () => {
  console.log(`[${new Date().toISOString()}] SIGTERM received - Shutting down...`);
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log(`[${new Date().toISOString()}] SIGINT received - Shutting down...`);
  process.exit(0);
});