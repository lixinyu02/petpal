import type { ApprovalReviewCapability, AgentApprovalReview } from './api';
export function canUseApprovalReview(capability?:ApprovalReviewCapability):boolean;
export function approvalReviewCapabilityNote(capability?:ApprovalReviewCapability,model?:string):string;
export function approvalReviewLabel(review?:AgentApprovalReview):string;
