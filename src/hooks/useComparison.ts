import { useHyphaStore } from '../store/hyphaStore';

export const useComparison = () => {
  const {
    segmentationModelIds,
    bioenginePassedModelIds,
    selectedComparisonIds,
    toggleComparisonSelection,
    clearComparisonSelection,
    isLoggedIn,
    artifactManager,
  } = useHyphaStore();

  const isSegmentation = (id: string) => segmentationModelIds.includes(id);
  const isBioEnginePassed = (id: string) => bioenginePassedModelIds.includes(id);
  const isSelected = (id: string) => selectedComparisonIds.includes(id);
  const isSelectable = (id: string) => isSegmentation(id) && isBioEnginePassed(id);
  const isFull = selectedComparisonIds.length >= 6;

  const tooltipMessage = (id: string): string | null => {
    const seg = isSegmentation(id);
    const bio = isBioEnginePassed(id);
    if (!seg && !bio) {
      return 'Only segmentation models that pass the BioEngine inference test can be selected for comparison';
    }
    if (!seg) {
      return 'Only segmentation models can be selected for comparison';
    }
    if (!bio) {
      return 'This model does not pass the BioEngine inference test';
    }
    if (isFull && !isSelected(id)) {
      return 'Maximum of 6 models already selected';
    }
    return null;
  };

  return {
    selectedIds: selectedComparisonIds,
    isSelected,
    toggleSelection: toggleComparisonSelection,
    clearSelection: clearComparisonSelection,
    isSelectable,
    isFull,
    tooltipMessage,
    canUseComparison: isLoggedIn && !!artifactManager,
  };
};
