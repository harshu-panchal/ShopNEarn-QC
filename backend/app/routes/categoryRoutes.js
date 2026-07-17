import express from "express";
import {
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory
} from "../controller/categoryController.js";
import { adminPermissionGuard } from "../middleware/authMiddleware.js";
import multer from "multer";

const storage = multer.memoryStorage();
const upload = multer({ storage });

const router = express.Router();

// Public route to get categories
router.get("/", getCategories);

// Admin only routes
router.post(
    "/",
    ...adminPermissionGuard("categories:create"),
    upload.single("image"),
    createCategory
);

router.put(
    "/:id",
    ...adminPermissionGuard("categories:update"),
    upload.single("image"),
    updateCategory
);

router.delete(
    "/:id",
    ...adminPermissionGuard("categories:delete"),
    deleteCategory
);

export default router;
