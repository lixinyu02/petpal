import type { ApprovalReviewCapability, AgentApprovalReview } from './api';
export function canUseApprovalReview(capability?:ApprovalReviewCapability):boolean;
export function canUseIndependentApprovalReview(capability?:ApprovalReviewCapability):boolean;
export function approvalReviewLabel(review?:AgentApprovalReview):string;
