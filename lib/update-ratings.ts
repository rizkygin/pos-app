type UpdateRatingsProps = {
    oldRating: number;
    reviewCount: number;
    newRating: number;
}

export const updateRatings = ({oldRating, reviewCount, newRating}: UpdateRatingsProps) => {
    const newTotalRatings = oldRating * reviewCount + newRating;
    const newReviewCount = reviewCount + 1;
    const newAverage = newTotalRatings / newReviewCount;
    return {newAverage, newReviewCount}
}