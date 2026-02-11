# Model Card Template

> **Instructions**: This template provides a structured format for documenting your AI model when contributing to the RI-SCALE Model Hub. It integrates best practices from the [Hugging Face Model Card Template](https://huggingface.co/docs/hub/en/model-card-annotated) while maintaining domain-specific requirements. Replace the placeholder text with information specific to your model. This documentation should be saved as `README.md` in your model folder and helps reviewers and users understand your model's purpose, performance, and appropriate usage.

---

# [Model Name]

*Brief 1-2 sentence summary of what the model does*

*Example: "3D U-Net model for segmentation of mitochondria in electron microscopy images of HeLa cells, trained on high-resolution volumetric EM data."*

# Table of Contents

- [Model Details](#model-details)
- [Uses](#uses)
- [Task Details](#task-details)
- [Bias, Risks, and Limitations](#bias-risks-and-limitations)
- [Training Details](#training-details)
- [Evaluation](#evaluation)
- [Environmental Impact](#environmental-impact)
- [Technical Specifications](#technical-specifications)
- [How to Get Started with the Model](#how-to-get-started-with-the-model)

# Model Details

## Model Description

*Provide basic details about the model including architecture, version, creators, and important disclaimers specific to your scientific domain.*

- **Developed by:** *[Name(s), Institution(s)]*
- **Funded by:** *[Funding agency, grant number if applicable]*
- **Shared by:** *[Person/organization making the model available]*
- **Model type:** *[Architecture type, e.g., 3D U-Net, ResNet, transformer]*
- **Modality:** *[Input modality, e.g., fluorescence microscopy, electron microscopy]*
- **License:** *[License name and link]*
- **Finetuned from model:** *[Base model if applicable]*

## Model Sources

- **Repository:** *[GitHub repository URL]*
- **Paper:** *[Associated publication DOI/URL]*
- **Demo:** *[Online demo or notebook URL]*


# Uses

## Direct Use

*Explain how the model can be used without fine-tuning for data analysis tasks. Provide examples images and/or videos for the data used to train the model, provide guidance on what type of data is required for the model to work.*


## Downstream Use

*Explain how this model can be fine-tuned or integrated into larger data analysis pipelines.*

## Out-of-Scope Use

*List how the model may be misused in scientific data analysis contexts and what users should not do with the model.*

*Examples:*
- *Not suitable for diagnostic purposes*
- *Not validated for different imaging modalities than training data*
- *Should not be used without proper validation on user's specific datasets*

# Task Details

*Domain-specific task information*

- **Task type:** *[segmentation, classification, detection, denoising, etc.]*
- **Input modality:** *[2D/3D fluorescence, brightfield, EM, etc.]*
- **Target structures:** *[nuclei, cells, organelles, etc.]*
- **Imaging technique:** *[confocal, widefield, super-resolution, etc.]*
- **Spatial resolution:** *[pixel/voxel size requirements]*
- **Temporal resolution:** *[if applicable]*

# Bias, Risks, and Limitations

*Identify foreseeable harms, misunderstandings, and technical limitations specific to your scientific domain.*

## Known Biases

*Describe biases in training data or model behavior:*
- *Species-specific training data limitations*
- *Imaging protocol dependencies*
- *Cell type or experimental condition biases*

## Risks

*Potential risks in scientific data analysis applications:*
- *Misinterpretation of results*
- *Over-reliance on automated analysis*
- *Generalization to unseen experimental conditions*

## Limitations

*Technical limitations and failure modes:*
- *Resolution requirements*
- *Imaging condition dependencies*
- *Performance degradation scenarios*

## Recommendations

*Mitigation strategies and best practices:*
- *Always validate on your specific dataset*
- *Use appropriate controls and manual verification*
- *Consider domain adaptation for different experimental setups*

# Training Details

## Training Data

*Describe the training dataset with domain-specific details:*

- **Source:** *[Dataset name, publication, or source]*
- **Size:** *[Number of images, total volume, number of annotations]*
- **Modality:** *[Imaging technique and parameters]*
- **Biological systems:** *[Cell types, organisms, experimental conditions]*
- **Ground truth:** *[Annotation method and quality]*
- **Data splits:** *[Training/validation/test ratios]*

## Training Procedure

### Preprocessing

*Detail image preprocessing steps:*
- *Normalization methods*
- *Augmentation strategies*
- *Resizing/resampling procedures*
- *Artifact handling*

### Training Hyperparameters

- **Architecture:** *[Detailed architecture description]*
- **Framework:** *[PyTorch, TensorFlow, etc.]*
- **Epochs:** *[Number of training epochs]*
- **Batch size:** *[Training batch size]*
- **Learning rate:** *[Initial LR and schedule]*
- **Loss function:** *[Loss function and rationale]*
- **Optimizer:** *[Optimizer and parameters]*
- **Regularization:** *[Dropout, weight decay, etc.]*

### Speeds, Sizes, Times

- **Training time:** *[Total training duration]*
- **Model size:** *[Number of parameters, file size]*
- **Inference time:** *[Time per image/volume]*
- **Memory requirements:** *[GPU memory needed]*

# Evaluation

## Testing Data, Factors & Metrics

### Testing Data

*Describe test dataset or link to Dataset Card:*
- **Source:** *[Test dataset details]*
- **Size:** *[Number of test samples]*
- **Biological diversity:** *[Range of conditions tested]*

### Factors

*Characteristics that influence model behavior:*
- *Imaging conditions (SNR, resolution, etc.)*
- *Biological factors (cell type, experimental conditions)*
- *Technical factors (microscope type, acquisition parameters)*

### Metrics

*Evaluation metrics appropriate for your scientific domain:*
- *Segmentation: IoU, Dice coefficient, Hausdorff distance*
- *Classification: Accuracy, precision, recall, F1-score*
- *Detection: mAP, precision-recall curves*
- *Denoising: PSNR, SSIM, perceptual metrics*

## Results

### Quantitative Results

*Present results disaggregated by relevant factors:*

| Metric | Overall | Condition A | Condition B | Condition C |
|--------|---------|-------------|-------------|-------------|
| IoU    | 0.XX ± 0.XX | 0.XX ± 0.XX | 0.XX ± 0.XX | 0.XX ± 0.XX |
| Dice   | 0.XX ± 0.XX | 0.XX ± 0.XX | 0.XX ± 0.XX | 0.XX ± 0.XX |

### Summary

*Interpretation of results for general audience:*
- *Model performance summary*
- *Comparison to existing methods*
- *Limitations and areas for improvement*

### Validation on External Data

*Results on independent datasets if available*

## Societal Impact Assessment

*Assessment of broader impacts for scientific data analysis:*
- *Potential for misuse in research*
- *Impact on research reproducibility*
- *Accessibility and democratization of analysis tools*
- *Educational and training implications*

# Environmental Impact

*Environmental considerations for model training and deployment:*

- **Hardware Type:** *[GPU/CPU specifications]*
- **Hours used:** *[Total compute hours]*
- **Cloud Provider:** *[If applicable]*
- **Compute Region:** *[Geographic location]*
- **Carbon Emitted:** *[CO2 equivalent if calculated]*

*Carbon emissions can be estimated using the [Machine Learning Impact calculator](https://mlco2.github.io/impact#compute)*

# Technical Specifications

## Model Architecture and Objective

*Detailed technical specifications:*

- **Architecture:** *[Detailed network architecture]*
- **Input specifications:** *[Tensor shapes, data types, preprocessing]*
- **Output specifications:** *[Output format and interpretation]*
- **Objective function:** *[Loss function and optimization details]*

## Compute Infrastructure

### Hardware Requirements

*Minimum and recommended hardware:*
- **Training:** *[GPU memory, compute requirements]*
- **Inference:** *[Minimum hardware for deployment]*
- **Storage:** *[Model size and data requirements]*

### Software Dependencies

*Software requirements:*
- **Framework:** *[Deep learning framework version]*
- **Libraries:** *[Key dependencies and versions]*
- **RI-SCALE Model Hub compatibility:** *[Supported consumer software]*

# How to Get Started with the Model

*Provide step-by-step instructions for using the model:*


---

## Glossary

*Define domain-specific terms:*

- **IoU (Intersection over Union):** *Metric for evaluating segmentation quality*
- **Dice coefficient:** *Similarity metric for binary segmentation*
- **Voxel:** *3D pixel representing volume element*
- **Z-projection:** *2D representation of 3D data*

---

*This model card was created using the RI-SCALE Model Hub template, incorporating best practices from the Hugging Face Model Card Template. For more information on contributing models, visit [RI-SCALE Model Hub](https://modelhub.riscale.eu).*

---

**References:**
- [Hugging Face Model Card Template](https://huggingface.co/docs/hub/en/model-card-annotated)
- [RI-SCALE Model Hub Documentation](https://modelhub.riscale.eu/docs/)
- [Model Cards for Model Reporting](https://arxiv.org/abs/1810.03993) 