# Developer Guide

## Models in the BioImage Model Zoo
A BioImage.IO model is a zip file containing all the items, technical description and metadata of the model, together with the trained architecture of the model. Briefly, a BioImage.IO model has at least, the following items:
* Trained model in the correct format (check the Resource Description File Specifications for the [supported formats](https://bioimage.io/docs/#/bioimageio_preprocessing_spec))
* Example input image (numpy array)
* Example output (numpy array)
* Resource description file specifications (`rdf.yaml`)
* An example cover image for visual representation of the model in the zoo.

In some cases, the model may need additional files.

### Model contribution requirements

- Follow the [BioImage.IO Model Resource Description File Specification (RDF)](https://bioimage.io/docs/#/bioimageio_model_spec) with `format_version>= 0.4.5`. 
- The model is expected to be cross-compatible among the [consumer software](https://github.com/bioimage-io/spec-bioimage-io/blob/master/supported_formats_and_operations.md#consumers), and should always run on at least one.
- The model should be well documented (i.e., human readable name and rich description tailored for life-scientists, citations)
- The model should be public and can be used by anyone under the chosen licensing conditions.

### Model contribution guidelines - upload a model to the BioImage Model Zoo

**1. Create a BioImage.IO model** 
Two options:
   1. Choose one way to create your model:
      - Automatic export of the model using the [bioimageio.core python library](https://github.com/bioimage-io/core-bioimage-io-python) (recomended).
        Example code [here](https://github.com/bioimage-io/core-bioimage-io-python/blob/main/example/model_creation.ipynb).
          - The main function to build the model is `bioimageio.core.build_model`. Check its input variables to know what has to be provided.
      - Manual generation of the model:
         - Create the [BioImage.IO Model Resource Description File Specifications](https://bioimage.io/docs/#/bioimageio_model_spec) (`rdf.yaml` file).
         - Each field on the file is either mandatory or optional. In the Bioimage Model Zoo web page you can find different examples. 
   2. Check that the model is correctly created:
      - Static validation of the model format using the [bioimageio.core python library](https://github.com/bioimage-io/core-bioimage-io-python) library (*e.g.*, in the terminal, `bioimageio validate /../rdf.yaml`).
      - Dynamic validation of the model's deployment (*e.g.*, in the terminal, `bioimageio test-model --weights tensorflow_saved_model_bundle --device cpu /.../rdf.yaml`). It tests that the model generates the expected output.
      
**2. Upload the model to the BioImage Model Zoo**

To upload a model to the BioImage Model Zoo, you have a tutorial video of the process step by step available [here](https://oc.embl.de/index.php/s/JBWwJGgsXh0vYM6).
         
<img src="contribute_models/contribute_model.png" align="center" width="1000"/>

For a detailed explanation, follow these steps:
    1. In [BioImage.IO](https://bioimage.io/), click on `+Upload` and follow the steps:
        
    2. Log in to Zenodo and give access to the BioEngine application. You will see an automatic message once you are logged in. If not, refresh the page. This step needs to be done only for the first time you upload a model. 

    3. Upload your model RDF. 
        <img src="contribute_models/upload_1.png" align="center" width="500"/>
    
    4. Complete the missing fields.
        <img src="contribute_models/upload_2.png" align="center" width="500"/>
        
        <img src="contribute_models/upload_3.png" align="center" width="500"/>
    
    5. A [Pull Request (PR)](https://github.com/bioimage-io/collection-bioimage-io/pulls/bioimageiobot) is generated (this process may take some minutes). In the PR, the model is tested by a Continuous Integration (CI) workflow for its technical correctness. and reviewed by a maintainer from the BioImage.IO team. This PR is aimed for further discussions between model contributors and the BioImage.IO team.

    6. Once the model passes all checks and has the approval of a maintainer, it will be added to the BioImage.IO collection and displayed in the webpage (this process may take some minutes). 


###  Model Documentation
#### Model naming

Models are expected to be used by life-scientists, thus, it is expected that the naming is human readable but also informative enough regarding the final application and the biological tissue being analysed. Example:
   
   **Name:** `Neuron Segmentation in EM (Membrane Prediction)`, `B. Sutilist bacteria segmentation - Widefield microscopy - 2D UNet`

   
#### Model Tags
The tags in the model RDF are used to search for each model in the BioImage Model Zoo. The more informative tags you write, the easier it will be for a potential user to find your model. Example:

   **My model description**: An encoder-decoder trained for denoising of point-scanning super-resolution microsocpy images of HeLa cells microtubules
   
   **Tags**: `denoising`, `PSSR`, `microtubules`, `encoder-decoder`, `deblurring`, `fluorescence`, `2D`, `HeLa cells`, `deepimagej`, `ilastik`, `image restoration`, `trained-model` etc.

#### Model links
The BioImage Model Zoo is a software webpage. Each model is displayed with an interactive card that can have datasets, notebooks, applications, consumer-software or test-run buttons linked. Example:
    
   **Links**: `imjoy/BioImageIO-Packager`, `ilastik/ilastik`, `deepimagej/deepimagej`, `zero/dataset_fnet_3d_zerocostdl4mic` etc.

#### Representative Covers

You can include different cover images that represent the analysed tissue, imaging modality, image processing task and the performance of the model. This image will be used in the model card to guide the users through the model search.


### Considerations for the model description file

When following the BioImage.IO model RDF specification provided at https://github.com/bioimage-io/spec-bioimage-io, it is important that you pay special attention to the following:
* Choose test input image(s) and generate the respective test output tensor(s). This enables our scripts to test your model for technical correctness and to test which [consumer software](https://bioimage.io/docs/#/consumer_software/model_runner) can process it.
* Pre-processing and post-processing should be always described. You can check which [preprocessing](https://github.com/bioimage-io/spec-bioimage-io/blob/gh-pages/preprocessing_spec_latest.md) and [postprocessing](https://github.com/bioimage-io/spec-bioimage-io/blob/gh-pages/postprocessing_spec_latest.md) functions are supported at the moment and open an [issue here](https://github.com/bioimage-io/spec-bioimage-io/issues) if you are missing a specific operation. 
* Do not forget to include any additional files needed for the correct execution of the model during the upload process.

## Other contributions
You are welcome to submit your **models**, **datasest**, **applicaitons** and Jupyter **notebooks** to BioImage.IO.

To add an resource item to BioImage.IO, you need to provide a set of basic information about the resouce, including name, description, authors etc. and we will generate a resource card to display in the website.

For Community Partners, you can add models directly to the linked repository. If you are not part of the community partners, you can follow the instructions below to submit resource items (models, datasets etc.) to BioImage.IO.

### Submit to BioImage.IO
* Step 1, prepare a [`Resource Description File`](/bioimageio_rdf_spec)(RDF) and complete at least the mandatory fields and ideally also the recommended fields for different types of resource.

* Step 2, save the RDF file in one of the public git hosting website, it is recommended to store the RDF file in your project git repository on Github/Gitlab/Bitbucket (make sure it's a public repo). Alternatively, you can post it on [Gist](https://gist.github.com/), copy the the **raw** url to the actual file content.

* Step 3, post the url to the comment box below (if you don't see it, click [here](https://github.com/bioimage-io/bioimage-io-models/issues/26)). And the admin team will check and verify the format and incooperate to BioImage.IO if the submitted file is qualified.