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
  CLIENT_URL: "https://your-frontend-url.com",
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
  }
};

// ============ MIDDLEWARE ============
app.use(cors({ 
  origin: CONFIG.CLIENT_URL, 
  credentials: true 
}));

// Request logging middleware
app.use((req, res, next) => {
  log.request(req);
  next();
});

app.use(
  session({ 
    secret: CONFIG.SESSION_SECRET, 
    resave: true, 
    saveUninitialized: true,
    cookie: {
      secure: true,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
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

// Facebook Strategy with comprehensive logging
passport.use(
  new FacebookStrategy(
    {
      clientID: CONFIG.FACEBOOK_APP_ID,
      clientSecret: CONFIG.FACEBOOK_APP_SECRET,
      callbackURL: CONFIG.CALLBACK_URL,
      profileFields: ["id", "displayName", "emails", "picture.type(large)"],
      state: true
    },
    (accessToken, refreshToken, profile, done) => {
      log.auth("Facebook authentication received", {
        displayName: profile.displayName,
        id: profile.id,
        email: profile.emails?.[0]?.value || "No email provided",
        provider: profile.provider,
        hasPicture: !!profile.photos?.[0]?.value
      });

      // Log all profile data
      log.info("Complete profile data", {
        id: profile.id,
        displayName: profile.displayName,
        name: profile.name,
        emails: profile.emails,
        photos: profile.photos?.map(p => p.value),
        provider: profile.provider,
        _raw: profile._raw ? "Raw data available" : "No raw data"
      });

      // Check for existing user in database (mock)
      log.info("Checking if user exists in database", { 
        userId: profile.id,
        email: profile.emails?.[0]?.value 
      });

      // In a real app, you would check your database here
      // Example: const existingUser = await User.findOne({ facebookId: profile.id });
      // log.info("User lookup result", { exists: !!existingUser });

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
  log.info("Health check endpoint called");
  res.json({
    status: "Server is running",
    environment: CONFIG.ENVIRONMENT,
    authenticated: req.isAuthenticated() || false,
    timestamp: new Date().toISOString(),
    endpoints: [
      "GET / - Health check",
      "GET /auth/facebook - Initiate Facebook login",
      "GET /auth/facebook/callback - Facebook OAuth callback",
      "GET /status - Server status",
      "GET /profile - Get authenticated user",
      "GET /logout - Logout user",
      "GET /auth/reset-session - Reset session",
      "GET /auth/logs - View recent authentication logs (in memory)"
    ]
  });
});

// Initiate Facebook login
app.get("/auth/facebook", (req, res, next) => {
  log.auth("Initiating Facebook login", {
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    sessionId: req.sessionID || "No session"
  });
  
  passport.authenticate("facebook", { 
    scope: ["email"]
  })(req, res, next);
});

// Facebook OAuth callback
app.get(
  "/auth/facebook/callback",
  (req, res, next) => {
    log.auth("Facebook callback received", {
      query: req.query,
      sessionId: req.sessionID || "No session"
    });
    
    passport.authenticate("facebook", { 
      failureRedirect: "/login-failed",
      failureMessage: true
    })(req, res, next);
  },
  (req, res) => {
    log.success("Authentication successful", {
      user: {
        id: req.user.id,
        displayName: req.user.displayName,
        email: req.user.emails?.[0]?.value || null
      },
      sessionId: req.sessionID,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: "Authentication successful",
      user: {
        id: req.user.id,
        displayName: req.user.displayName,
        email: req.user.emails?.[0]?.value || null,
        picture: req.user.photos?.[0]?.value || null,
        provider: req.user.provider
      }
    });
  }
);

// Reset session
app.get("/auth/reset-session", (req, res) => {
  log.info("Session reset requested", {
    sessionId: req.sessionID || "No session"
  });
  
  req.session.destroy((err) => {
    if (err) {
      log.error("Session reset failed", { error: err.message });
      return res.status(500).json({ success: false, message: "Failed to reset session" });
    }
    log.success("Session reset successful");
    res.json({ success: true, message: "Session reset successfully" });
  });
});

// Login failed
app.get("/login-failed", (req, res) => {
  const error = req.session.messages ? req.session.messages[0] : "Authentication failed";
  log.error("Login failed", {
    error: error,
    sessionId: req.sessionID || "No session",
    query: req.query,
    timestamp: new Date().toISOString()
  });
  
  res.status(401).json({
    success: false,
    message: "Authentication failed",
    error: error,
    timestamp: new Date().toISOString()
  });
});

// Server status with detailed info
app.get("/status", (req, res) => {
  const status = { 
    status: "Server is running", 
    authenticated: req.isAuthenticated() || false,
    environment: CONFIG.ENVIRONMENT,
    timestamp: new Date().toISOString(),
    sessionId: req.sessionID || "No session",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version
  };
  
  log.info("Status check", {
    authenticated: status.authenticated,
    sessionId: status.sessionId
  });
  
  res.json(status);
});

// Get authenticated user profile
app.get("/profile", (req, res) => {
  if (!req.isAuthenticated()) {
    log.warn("Unauthorized profile access attempt", {
      sessionId: req.sessionID || "No session",
      ip: req.ip
    });
    
    return res.status(401).json({ 
      success: false,
      message: "Not authenticated. Please login first." 
    });
  }
  
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

// Logout
app.get("/logout", (req, res) => {
  log.info("Logout requested", {
    user: req.user?.displayName || "Unknown",
    userId: req.user?.id || "Unknown",
    sessionId: req.sessionID
  });
  
  req.logout((err) => {
    if (err) {
      log.error("Logout failed", { error: err.message });
      return res.status(500).json({ success: false, message: "Logout failed" });
    }
    log.success("Logout successful", {
      sessionId: req.sessionID
    });
    res.json({ success: true, message: "Logged out successfully" });
  });
});

// Detailed logs endpoint (for debugging)
let recentLogs = [];
app.get("/auth/logs", (req, res) => {
  log.info("Log endpoint accessed");
  res.json({
    recentLogs: recentLogs.slice(-50),
    totalLogs: recentLogs.length,
    timestamp: new Date().toISOString()
  });
});

// ============ ERROR HANDLING ============

// 404 handler
app.use((req, res) => {
  log.warn("Route not found", {
    method: req.method,
    url: req.url,
    ip: req.ip
  });
  
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

// Global error handler
app.use((err, req, res, next) => {
  log.error("Global error", {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  // Handle authorization code error
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
  console.log(`💾 Session Secret: ${CONFIG.SESSION_SECRET.substring(0, 10)}...`);
  console.log("=".repeat(60));
  console.log(`[${new Date().toISOString()}] ✅ Server is ready to handle requests`);
  console.log(`[${new Date().toISOString()}] 📋 Logging enabled for all authentication events`);
  console.log("=".repeat(60));
});

// Handle graceful shutdown
process.on("SIGTERM", () => {
  log.info("SIGTERM received - Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  log.info("SIGINT received - Shutting down gracefully...");
  process.exit(0);
});