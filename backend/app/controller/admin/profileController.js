import Admin from "../../models/admin.js";
import handleResponse from "../../utils/helper.js";
import {
  resolveAdminAccess,
  sanitizeAdminForResponse,
} from "../../services/admin/adminRbacService.js";

export const getAdminProfile = async (req, res) => {
  try {
    if (!req.user?.id) {
      return handleResponse(res, 400, "Missing user ID in session");
    }

    // Prefer access already resolved by requireActiveAdmin.
    if (req.admin && req.adminAccess) {
      return handleResponse(
        res,
        200,
        "Admin profile fetched successfully",
        sanitizeAdminForResponse(req.admin, {
          _id: req.adminAccess.roleId,
          key: req.adminAccess.roleKey,
          name: req.adminAccess.roleName,
          permissions: req.adminAccess.permissions,
        }),
      );
    }

    const access = await resolveAdminAccess(req.user.id);
    return handleResponse(
      res,
      200,
      "Admin profile fetched successfully",
      sanitizeAdminForResponse(access.admin, access.role),
    );
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const updateAdminProfile = async (req, res) => {
  try {
    const { name, email } = req.body;

    const admin = await Admin.findById(req.user.id).populate("roleId");
    if (!admin) {
      return handleResponse(res, 404, "Admin not found");
    }

    if (name) {
      admin.name = name;
    }

    if (email) {
      admin.email = email;
    }

    const updatedAdmin = await admin.save();

    return handleResponse(
      res,
      200,
      "Admin profile updated successfully",
      sanitizeAdminForResponse(updatedAdmin, updatedAdmin.roleId),
    );
  } catch (error) {
    if (error.code === 11000) {
      return handleResponse(res, 400, "Email already in use");
    }

    return handleResponse(res, 500, error.message);
  }
};

export const updateAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const admin = await Admin.findById(req.user.id).select("+password");
    if (!admin) {
      return handleResponse(res, 404, "Admin not found");
    }

    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      return handleResponse(res, 401, "Invalid current password");
    }

    admin.password = newPassword;
    admin.tokenVersion = Number(admin.tokenVersion || 0) + 1;
    await admin.save();

    return handleResponse(
      res,
      200,
      "Password updated successfully. Please sign in again.",
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
