import express from 'express';
import { getFAQs, createFAQ, updateFAQ, deleteFAQ } from '../controller/faqController.js';
import { adminPermissionGuard } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public / general read
router.get('/', getFAQs);
router.get('/:id', getFAQs);

// Admin write routes
router.post('/', ...adminPermissionGuard('content:create'), createFAQ);
router.put('/:id', ...adminPermissionGuard('content:update'), updateFAQ);
router.delete('/:id', ...adminPermissionGuard('content:delete'), deleteFAQ);

export default router;
