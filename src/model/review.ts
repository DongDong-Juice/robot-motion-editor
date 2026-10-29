// 검수 판정 ranges (Project.review, §13): two ranges of one clip are the same spot when they overlap within SLACK frames —
// a re-check may start or end an item a frame or two off (a return jump). Shared by the store and src/review/verdicts.ts.
export const REVIEW_SLACK = 2
export const reviewOverlap = (a0: number, a1: number, b0: number, b1: number) => a0 <= b1 + REVIEW_SLACK && b0 <= a1 + REVIEW_SLACK
