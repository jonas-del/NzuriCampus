"use strict";

const requireAdmin = (req, res, next) => {
  if (!req.session || !req.session.adminId) {
    res.status(401).json({
      success: false,
      message: "Please sign in to continue."
    });
    return;
  }

  next();
};

module.exports = requireAdmin;
