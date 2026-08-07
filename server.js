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
  // Allow all origins for testing - you can restrict this later
  CLIENT_URL: "*",  // ← Fixed: Allow all origins
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
// Updated CORS configuration
app.use(cors({ 
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow all origins in production (or you can restrict to specific domains)
    const allowedOrigins = [
      'https://your-frontend-url.com',
      'http://localhost:3000',
      'http://localhost:3001',
      // Add your actual frontend URL here when deployed
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1 || CONFIG.CLIENT_URL === '*') {
      callback(null, true);
    } else {
      log.warn('CORS blocked origin:', { origin });
      callback(null, true); // Allow all for now
    }
  }, 
  credentials: true 
}));

// Request logging middleware
app.use((req, res, next) => {
  log.request(req);
  next();
});

// ============ FIXED SESSION CONFIGURATION ============
app.use(
  session({ 
    secret: CONFIG.SESSION_SECRET, 
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,  // Render handles SSL at load balancer
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

// Facebook Strategy
passport.use(
  new FacebookStrategy(
    {
      clientID: CONFIG.FACEBOOK_APP_ID,
      clientSecret: CONFIG.FACEBOOK_APP_SECRET,
      callbackURL: CONFIG.CALLBACK_URL,
      profileFields: ["id", "displayName", "emails", "picture.type(large)"],
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

      // Check if this code was already used in this session
      if (req.session && req.session.usedAuthCode) {
        log.warn("Duplicate auth attempt detected, rejecting...", {
          sessionId: req.sessionID
        });
        return done(null, false, { message: "Authorization code already used" });
      }
      
      // Mark this session as having used the code
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
  log.info("Health check endpoint called");
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
      "GET /auth/reset-session - Reset session"
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
  
  req.session.loginInitiated = Date.now();
  
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
      sessionId: req.sessionID || "No session",
      cookies: req.headers.cookie || "No cookies"
    });
    
    if (req.session && req.session.usedAuthCode) {
      log.warn("Session already used an auth code, redirecting to login failed", {
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

    req.session.usedAuthCode = false;
    
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
    hint: "Try visiting /auth/reset-session to clear your session"
  });
});

// Server status
app.get("/status", (req, res) => {
  const status = { 
    status: "Server is running", 
    authenticated: req.isAuthenticated() || false,
    environment: CONFIG.ENVIRONMENT,
    timestamp: new Date().toISOString(),
    sessionId: req.sessionID || "No session",
    uptime: process.uptime()
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
  console.log(`🌍 CORS: All origins allowed (for testing)`);
  console.log(`🍪 Cookie Secure: false (Render handles SSL)`);
  console.log("=".repeat(60));
  console.log(`[${new Date().toISOString()}] ✅ Server is ready to handle requests`);
  console.log("=".repeat(60));
});

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log(`[${new Date().toISOString()}] SIGTERM received - Shutting down...`);
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log(`[${new Date().toISOString()}] SIGINT received - Shutting down...`);
  process.exit(0);
});