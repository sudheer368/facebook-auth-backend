const express = require("express");
const session = require("express-session");
const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const cors = require("cors");
const crypto = require("crypto");

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

// ============ MIDDLEWARE ============
app.use(cors({ 
  origin: CONFIG.CLIENT_URL, 
  credentials: true 
}));

// Session configuration with better production settings
app.use(
  session({ 
    secret: CONFIG.SESSION_SECRET, 
    resave: true,  // Changed to true
    saveUninitialized: true,  // Changed to true
    cookie: {
      secure: true,  // Always true for HTTPS
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'  // Added for better security
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ============ PASSPORT CONFIGURATION ============
passport.serializeUser((user, done) => {
  console.log("Serializing user:", user.id);
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  console.log("Deserializing user:", obj.id);
  done(null, obj);
});

// Facebook Strategy with better error handling
passport.use(
  new FacebookStrategy(
    {
      clientID: CONFIG.FACEBOOK_APP_ID,
      clientSecret: CONFIG.FACEBOOK_APP_SECRET,
      callbackURL: CONFIG.CALLBACK_URL,
      profileFields: ["id", "displayName", "emails", "picture.type(large)"],
      passReqToCallback: true  // Allows access to request object
    },
    (req, accessToken, refreshToken, profile, done) => {
      console.log("Facebook callback received for user:", profile.displayName);
      console.log("User ID:", profile.id);
      console.log("Email:", profile.emails?.[0]?.value || "No email provided");
      
      // Check if this code was already used (prevents duplicate processing)
      if (req.session && req.session.usedAuthCode) {
        console.log("Duplicate auth attempt detected, rejecting...");
        return done(null, false, { message: "Authorization code already used" });
      }
      
      // Mark this session as having used the code
      if (req.session) {
        req.session.usedAuthCode = true;
      }
      
      return done(null, profile);
    }
  )
);

// ============ ROUTES ============

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "Server is running",
    environment: CONFIG.ENVIRONMENT,
    authenticated: req.isAuthenticated() || false,
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

// Initiate Facebook login with state parameter
app.get("/auth/facebook", (req, res, next) => {
  // Generate a random state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  
  passport.authenticate("facebook", { 
    scope: ["email"],
    state: state
  })(req, res, next);
});

// Facebook OAuth callback
app.get(
  "/auth/facebook/callback",
  (req, res, next) => {
    // Verify state parameter to prevent CSRF
    const state = req.query.state;
    if (!state || state !== req.session.oauthState) {
      console.log("State mismatch or missing");
      return res.status(400).json({
        success: false,
        message: "Invalid state parameter. Please try again."
      });
    }
    
    // Clear the state to prevent reuse
    delete req.session.oauthState;
    
    passport.authenticate("facebook", { 
      failureRedirect: "/login-failed",
      failureMessage: true
    })(req, res, next);
  },
  (req, res) => {
    // Success response with user data
    console.log("Authentication successful for:", req.user.displayName);
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

// Reset session - useful for clearing stuck sessions
app.get("/auth/reset-session", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Session reset error:", err);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to reset session" 
      });
    }
    res.json({ 
      success: true, 
      message: "Session reset successfully. You can try logging in again." 
    });
  });
});

// Login failed endpoint
app.get("/login-failed", (req, res) => {
  const error = req.session.messages ? req.session.messages[0] : "Unknown error";
  console.log("Login failed:", error);
  
  res.status(401).json({
    success: false,
    message: "Authentication failed",
    error: error
  });
});

// Server status
app.get("/status", (req, res) => {
  res.json({ 
    status: "Server is running", 
    authenticated: req.isAuthenticated() || false,
    environment: CONFIG.ENVIRONMENT,
    timestamp: new Date().toISOString(),
    sessionId: req.sessionID || "No session"
  });
});

// Get authenticated user profile
app.get("/profile", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ 
      success: false,
      message: "Not authenticated. Please login first." 
    });
  }
  
  res.json({
    success: true,
    user: {
      id: req.user.id,
      displayName: req.user.displayName,
      email: req.user.emails?.[0]?.value || null,
      picture: req.user.photos?.[0]?.value || null,
      provider: req.user.provider
    }
  });
});

// Logout user
app.get("/logout", (req, res) => {
  console.log("Logging out user:", req.user?.displayName || "Unknown");
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ 
        success: false,
        message: "Logout failed" 
      });
    }
    res.json({ 
      success: true,
      message: "Logged out successfully" 
    });
  });
});

// ============ ERROR HANDLING ============

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err.stack);
  
  // Check if this is the "authorization code used" error
  if (err.message && err.message.includes("authorization code")) {
    return res.status(400).json({
      success: false,
      message: "This authorization code has been used. Please try logging in again.",
      hint: "Visit /auth/reset-session to reset your session"
    });
  }
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    ...(CONFIG.ENVIRONMENT === "development" && { stack: err.stack })
  });
});

// ============ START SERVER ============
app.listen(CONFIG.PORT, () => {
  console.log("=".repeat(50));
  console.log("🚀 Facebook Authentication Server");
  console.log("=".repeat(50));
  console.log(`📡 Server running on port: ${CONFIG.PORT}`);
  console.log(`🌐 Environment: ${CONFIG.ENVIRONMENT}`);
  console.log(`🔑 Facebook App ID: ${CONFIG.FACEBOOK_APP_ID}`);
  console.log(`📱 Client URL: ${CONFIG.CLIENT_URL}`);
  console.log(`🔄 Callback URL: ${CONFIG.CALLBACK_URL}`);
  console.log("=".repeat(50));
  console.log("✅ Server is ready to handle requests");
  console.log("=".repeat(50));
});

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down gracefully...");
  process.exit(0);
});