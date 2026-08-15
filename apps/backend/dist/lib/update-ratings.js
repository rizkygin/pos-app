"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRatings = void 0;
const updateRatings = ({ oldRating, reviewCount, newRating }) => {
    const newTotalRatings = oldRating * reviewCount + newRating;
    const newReviewCount = reviewCount + 1;
    const newAverage = newTotalRatings / newReviewCount;
    return { newAverage, newReviewCount };
};
exports.updateRatings = updateRatings;
