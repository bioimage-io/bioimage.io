# Help Desk

## Glossary
In the ever-evolving field of AI-driven scientific data analysis, understanding the terminology is essential. Explore our glossary to familiarize yourself with key terms and concepts used throughout the RI-SCALE Model Hub project.

| Term                                  | Definition                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Community Partner**                 | Usually, a community partner is an organization, a company, a research group, or a software team (of one or more) that can consume and/or produce resources of the RI-SCALE Model Hub. Additionally, most partners continuously and openly contribute resources of their own. The founders community partners represent open source consumer software of [RI-SCALE Model Hub](http://RI-SCALE Model Hub/) (e.g. [ilastik](https://www.ilastik.org), [Fiji](https://imagej.net/software/fiji/), [deepImageJ](https://deepimagej.github.io), [ZeroCostDL4Mic](https://github.com/HenriquesLab/ZeroCostDL4Mic), [StarDist](https://github.com/stardist/stardist)). A Community Partner can either be a team behind a software which produces or consumes trained models compatible with the [RI-SCALE Model Hub](http://modelhub.riscale.eu/) spec or an organization, group, company or team (of one or more) who contributed and will keep contributing more models to RI-SCALE Model Hub. |
| **Consumer**                          | Refers to an individual or user who engages with the project by utilizing the pre-existing models available on [RI-SCALE Model Hub](http://modelhub.riscale.eu/). Their primary role involves downloading these models and incorporating them into their workflow using compatible software or any specific manner that suits their needs. For example, a Life Scientist can be considered a consumer by accessing the[RI-SCALE Model Hub](http://modelhub.riscale.eu/), selecting a Deep Learning model relevant to their research, and integrating it into their preferred software, such as deepImageJ or other compatible platforms. As a consumer, their focus lies in leveraging the existing models to enhance their data analysis tasks, thereby benefiting from the diverse range of models provided by the RI-SCALE Model Hub. |
| **Contributor/Producer**                       | A contributor can either be an individual person or a group, entity, or software. As an individual contributor, your primary objective is to actively contribute to the project by uploading models to RI-SCALE Model Hub. By doing so, you expand the range of available models, enriching the repository and fostering the growth of the scientific research community. As a contributor, you play a crucial role in sharing your expertise and innovative models with the broader community, contributing to advancements in scientific data analysis. Similarly, a software contributor refers to a software application or system that actively participates in the project by uploading models to [RI-SCALE Model Hub](http://modelhub.riscale.eu/). These software contributors enhance the available models by providing new and diverse solutions, further expanding the capabilities of the RI-SCALE Model Hub. Whether you contribute as an individual or a software entity, your active involvement in uploading models to [RI-SCALE Model Hub](http://modelhub.riscale.eu/) is instrumental in supporting the project's objectives. By sharing your models, you contribute to the collective knowledge and empower researchers in scientific research. |
| **Consumer Software**                 | A consumer software refers to any software application or tool that utilizes the models from the RI-SCALE Model Hub repository. Consumer software is designed to interact with and make use of the pretrained AI models available in the RI-SCALE Model Hub. A consumer software is any software application or tool that utilize pretrained AI models for data analysis tasks, either through integration, execution, or interaction with the models available in the RI-SCALE Model Hub. |
| **Model Resource Description File Specifications (RDF YAML)** | The Model Resource Description File (RDF) specifications refer to a set of guidelines that define the structure and content of a YAML file used to describe the AI models with pretrained weights in a standardized format. The model RDF serves as a metadata file that provides essential information about the model, its properties, and its intended use. The RDF file contains both mandatory and optional fields that capture relevant details about the model, such as its architecture, input/output formats, preprocessing steps, and performance metrics. By following the Model RDF specifications, developers and researchers can create consistent and interoperable descriptions of their AI models, allowing seamless integration and sharing within the [RI-SCALE Model Hub](http://modelhub.riscale.eu/) ecosystem. |
| **Cross-compatibility** | Cross-compatibility refers to the ability of a model or software to function across different platforms, systems, or environments without requiring modifications or adaptations. In the context of the RI-SCALE Model Hub, cross-compatibility ensures that the pretrained AI models and consumer software are interoperable and can be seamlessly integrated into various data analysis workflows. By adhering to cross-compatibility standards, developers and users can access and utilize the models across different software applications and platforms, enhancing the accessibility and usability of the RI-SCALE Model Hub resources. |

## FAQs

Have questions about how to participate, contribute, or engage with the RI-SCALE Model Hub? Check out our Frequently Asked Questions (FAQs) for detailed answers and insights into making the most of your experience with our project.

**How can I participate in the RI-SCALE Model Hub?**
To participate, you can take on the role of a **Community Partner** or engage as a **Consumer** or **Contributor** of models from the RI-SCALE Model Hub.

- **Consumer**: As a Consumer, your role involves utilizing the existing models available on modelhub.riscale.eu by downloading and incorporating them into your workflow using connected software or in any specific manner. For instance, a Life Scientist can be a Consumer by using a Deep Learning model downloaded from modelhub.riscale.eu and integrating it into any compatible software (deepImageJ, Ilastik, ImJoy, ZeroCostDL4Mic, ...).

- **Contributor**: If your primary objective is to contribute models to modelhub.riscale.eu, then you are a Contributor. As such, you play a crucial role in expanding the range of available models and supporting the scientific research community.

**What is a Community Partner? Who can be a Community Partner?**

Usually, a **Community Partner** is an organization, a company, a research group, or a software team (of one or more) that can consume and/or produce models from/for the RI-SCALE Model Hub.

The first community partners represent open source consumer software of RI-SCALE Model Hub (e.g. ilastik, Fiji, deepImageJ, ZeroCostDL4Mic, StarDist).

A Community Partner can either be a team behind a software which produces or consumes trained models compatible with the RI-SCALE Model Hub specifications or an organization, group, company, or team (of one or more) who contributes models to RI-SCALE Model Hub.


**How can I upload a model to the RI-SCALE Model Hub?**

To contribute a model to the RI-SCALE Model Hub, please refer to the [Contribute Models section](https://modelhub.riscale.eu/docs/#/contribute_models/README). This section provides detailed instructions on how to upload a model, including the necessary steps and required files for your contribution.

**What does it mean that the model should be cross-compatible among different software?**

Models from the RI-SCALE Model Hub adhere to [the specs](https://github.com/bioimage-io/spec-bioimage-io?tab=readme-ov-file#specifications-for-bioimageio), a standarised format that allows the models to be used across different software applications. This means that if the uploaded models follow this standarisation, they will be cross-compatible among the different software or community partners that consume them. When uploading a model to the RI-SCALE Model Hub you need to ensure that the model will be cross-compatible among different software by adhering to the RI-SCALE Model Hub specifications.

**How can I report issues or provide feedback regarding models on RI-SCALE Model Hub?**

If you encounter a bug or wish to share feedback, please use our [GitHub issues page](https://github.com/ri-scale/model-hub/issues). We appreciate your input and kindly request that you ensure your feedback is not duplicated. Your contributions help improve the RI-SCALE Model Hub for the entire community.

**What is RI-SCALE?**

RI-SCALE is an EU-funded project that empowers Research Infrastructures with advanced tools for exploiting massive scientific datasets. It develops scalable Data Exploitation Platforms (DEPs) that extend research infrastructure capabilities with computational environments and AI-driven analytical tools.

**How is RI-SCALE related to the RI-SCALE Model Hub?**

RI-SCALE is a project closely aligned with the RI-SCALE Model Hub. It plays a significant role in supporting and enhancing the RI-SCALE Model Hub's mission and initiatives.

**Can I use models from the RI-SCALE Model Hub for commercial purposes?**
Yes, you are welcome to use the models from the RI-SCALE Model Hub for commercial purposes. However, we kindly request that you provide appropriate credits when using these models as a gesture of acknowledgment for the contributions of the model creators and the RI-SCALE Model Hub community.

## Code of Conduct
The code of conducte of the RI-SCALE Model Hub can be visited here: [Code of Conduct](/CODE_OF_CONDUCT.md)

## Contact us

If you can't find what you're looking for, there are several ways to communicate with us or get assistance. Here are some options:

- You can write an issue in our [GitHub repository](https://github.com/ri-scale/model-hub/issues).

- You can ask a question or post in the [Image.sc Forum](https://forum.image.sc) using the tag 'bioimageio'. This way, not only our team but also others facing similar issues can benefit from your post.

- Alternatively, you can contact us through our [contact form](https://oeway.typeform.com/to/K3j2tJt7), and someone will be available to assist with your questions.