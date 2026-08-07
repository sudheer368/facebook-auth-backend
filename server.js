const express = require("express");
const session = require("express-session");
const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const cors = require("cors");

const app = express();

// ============ CONFIGURATION ============
// Update these values for your deployment
const CONFIG = {
  PORT: 4400,
  FACEBOOK_APP_ID: "1012373291541065",
  FACEBOOK_APP_SECRET: "9d3b82a3d291a386d7b10c30a1fcb010",
  CALLBACK_URL: "http://localhost:4400/auth/facebook/callback",
  CLIENT_URL: "http://localhost:3000",
  SESSION_SECRET: "9d3b82a3d291a386d7b10c30a1fcb010",
  ENVIRONMENT: "development" // change to "production" for deployment
};
// ======================================

// Middleware
app.use(cors({ 
  origin: CONFIG.CLIENT_URL, 
  credentials: true 
}));

app.use(
  session({ 
    secret: CONFIG.SESSION_SECRET, 
    resave: false, 
    saveUninitialized: false,
    cookie: {
      secure: CONFIG.ENVIRONMENT === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Serialization
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Facebook Strategy
passport.use(
  new FacebookStrategy(
    {
      clientID: CONFIG.FACEBOOK_APP_ID,
      clientSecret: CONFIG.FACEBOOK_APP_SECRET,
      callbackURL: CONFIG.CALLBACK_URL,
      profileFields: ["id", "displayName", "emails", "picture.type(large)"],
    },
    (accessToken, refreshToken, profile, done) => {
      // Here you can save user to database
      console.log("Facebook user authenticated:", profile.displayName);
      console.log("User ID:", profile.id);
      console.log("Email:", profile.emails?.[0]?.value || "No email provided");
      
      // You can add database save logic here
      // Example: saveUserToDatabase(profile);
      
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
    endpoints: [
      "GET / - Health check",
      "GET /auth/facebook - Initiate Facebook login",
      "GET /auth/facebook/callback - Facebook OAuth callback",
      "GET /status - Server status",
      "GET /profile - Get authenticated user",
      "GET /logout - Logout user",
      "GET /users - List all users (if implemented)"
    ]
  });
});

// Initiate Facebook login
app.get("/auth/facebook", 
  passport.authenticate("facebook", { scope: ["email"] })
);

// Facebook OAuth callback
app.get(
  "/auth/facebook/callback",
  passport.authenticate("facebook", { 
    failureRedirect: "/login-failed",
    failureMessage: true 
  }),
  (req, res) => {
    // Send user data as JSON response
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

// Login failed endpoint
app.get("/login-failed", (req, res) => {
  res.status(401).json({
    success: false,
    message: "Authentication failed. Please try again."
  });
});

// Server status
app.get("/status", (req, res) => {
  res.json({ 
    status: "Server is running", 
    authenticated: req.isAuthenticated() || false,
    environment: CONFIG.ENVIRONMENT,
    timestamp: new Date().toISOString()
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
  req.logout((err) => {
    if (err) {
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
  console.error("Error:", err.stack);
  
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
  console.log(`📡 Server running on: http://localhost:${CONFIG.PORT}`);
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