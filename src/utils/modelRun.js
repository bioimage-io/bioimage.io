import { hyphaWebsocketClient } from "hypha-rpc";
import yaml from 'js-yaml';
import {
  tfjsToImJoy,
  imjoyToTfjs,
  ImgPadder,
  ImgTiler,
  ImgTile,
  TileMerger,
  MeanTileMerger,
  getNpyEndianness,
  parseAxes,
  isImg2Img as checkImg2Img
} from "./imgProcess";

// Base URL for accessing artifact files
const ARTIFACT_BASE_URL = "https://hypha.aicell.io/bioimage-io/artifacts";

// Helper to construct artifact file URLs
export const getArtifactFileUrl = (artifactId, filePath) => {
  if (!artifactId || !filePath) return null;
  if (filePath.startsWith('http')) return filePath;
  return `${ARTIFACT_BASE_URL}/${artifactId}/files/${filePath}?use_proxy=true`;
};


// Get the min shape from spec in both old and new formats
export const getMinShape = (inputSpec) => {
  if (!inputSpec) return null;
  
  // Old format: shape.min is an array
  if (inputSpec.shape && Array.isArray(inputSpec.shape.min)) {
    return inputSpec.shape.min;
  }
  
  // New format: size information is in each axis object
  if (Array.isArray(inputSpec.axes)) {
    return inputSpec.axes.map(axis => {
      // For 'space' type axes, get the minimum size
      if (axis.type === 'space' && axis.size && axis.size.min) {
        return axis.size.min;
      }
      // For channel type, use default or 1
      if (axis.type === 'channel') {
        return axis.channel_names ? axis.channel_names.length : 1;
      }
      // For batch, default to 1
      if (axis.type === 'batch') {
        return 1;
      }
      return 1; // Default min size
    });
  }
  
  return null;
};

// Get the step shape from spec in both old and new formats
export const getStepShape = (inputSpec) => {
  if (!inputSpec) return null;
  
  // Old format: shape.step is an array
  if (inputSpec.shape && Array.isArray(inputSpec.shape.step)) {
    return inputSpec.shape.step;
  }
  
  // New format: step information is in each axis object
  if (Array.isArray(inputSpec.axes)) {
    return inputSpec.axes.map(axis => {
      // For 'space' type axes, get the step size
      if (axis.type === 'space' && axis.size && axis.size.step) {
        return axis.size.step;
      }
      return 1; // Default step size
    });
  }
  
  return null;
};

// Get the data type from spec in both old and new formats
export const getDataType = (inputSpec) => {
  if (!inputSpec) return 'float32'; // Default
  
  // Old format: data_type is directly on the input spec
  if (typeof inputSpec.data_type === 'string') {
    return inputSpec.data_type;
  }
  
  // New format: data type is in the data object
  if (inputSpec.data && inputSpec.data.type) {
    return inputSpec.data.type;
  }
  
  return 'float32'; // Default to float32
};

// Get the halo information for output spec in both old and new formats
export const getHalo = (outputSpec) => {
  if (!outputSpec) return null;
  
  // Old format: halo is directly on the output spec
  if (Array.isArray(outputSpec.halo)) {
    return outputSpec.halo;
  }
  
  // New format: halo might be on individual space axes
  if (Array.isArray(outputSpec.axes)) {
    const haloValues = [];
    for (const axis of outputSpec.axes) {
      if (axis.type === 'space' && axis.halo !== undefined) {
        haloValues.push(axis.halo);
      } else {
        haloValues.push(0); // Default no halo
      }
    }
    return haloValues.length > 0 ? haloValues : null;
  }
  
  return null;
};

// Utility functions to handle both old and new RDF formats
export const getRdfTensorUrl = (rdf, type, index = 0) => {
  if (!rdf) return null;
  
  let url = null;
  
  // New format: tensors are defined in inputs/outputs with sample_tensor and test_tensor
  if (type.includes('input') && rdf.inputs && rdf.inputs.length > 0) {
    const input = rdf.inputs[index];
    if (type.includes('test') && input.test_tensor && input.test_tensor.source) {
      url = input.test_tensor.source;
    } else if (type.includes('sample') && input.sample_tensor && input.sample_tensor.source) {
      url = input.sample_tensor.source;
    }
  } else if (type.includes('output') && rdf.outputs && rdf.outputs.length > 0) {
    const output = rdf.outputs[index];
    if (type.includes('test') && output.test_tensor && output.test_tensor.source) {
      url = output.test_tensor.source;
    } else if (type.includes('sample') && output.sample_tensor && output.sample_tensor.source) {
      url = output.sample_tensor.source;
    }
  }
  
  // Old format: tensors are defined directly in the RDF
  if (!url) {
    if (type === 'test_inputs' && rdf.test_inputs && rdf.test_inputs.length > index) {
      url = rdf.test_inputs[index];
    } else if (type === 'test_outputs' && rdf.test_outputs && rdf.test_outputs.length > index) {
      url = rdf.test_outputs[index];
    } else if (type === 'sample_inputs' && rdf.sample_inputs && rdf.sample_inputs.length > index) {
      url = rdf.sample_inputs[index];
    } else if (type === 'sample_outputs' && rdf.sample_outputs && rdf.sample_outputs.length > index) {
      url = rdf.sample_outputs[index];
    }
  }
  
  // If URL is not an absolute URL (doesn't start with http/https), build the full URL
  if (url && !url.startsWith('http')) {
    url = getArtifactFileUrl(rdf.id, url);
  }
  
  return url;
};

// Helper to check if RDF has a specific tensor type (works with both formats)
export const rdfHasTensor = (rdf, type) => {
  if (!rdf) return false;
  
  // Check old format
  if (rdf[type] !== undefined && rdf[type].length > 0) {
    return true;
  }
  
  // Check new format
  if (type.includes('input') && rdf.inputs && rdf.inputs.length > 0) {
    const input = rdf.inputs[0];
    if (type.includes('test') && input.test_tensor && input.test_tensor.source) {
      return true;
    } else if (type.includes('sample') && input.sample_tensor && input.sample_tensor.source) {
      return true;
    }
  } else if (type.includes('output') && rdf.outputs && rdf.outputs.length > 0) {
    const output = rdf.outputs[0];
    if (type.includes('test') && output.test_tensor && output.test_tensor.source) {
      return true;
    } else if (type.includes('sample') && output.sample_tensor && output.sample_tensor.source) {
      return true;
    }
  }
  
  return false;
};

export const loadCellposeRdf = () => {
  const cellposeRdf = {
    id: "cellpose-python",
    name: "Cellpose",
    nickname: "cellpose-python",
    nickname_icon: "🌸",
    description: "Cellpose model for segmenting nuclei and cytoplasms.",
    inputs: [
      {
        axes: "cyx",
        data_type: "float32",
        shape: {
          min: [1, 64, 64],
          step: [1, 16, 16],
        },
      },
    ],
    outputs: [
      {
        axes: "cyx",
      },
    ],
    sample_inputs: [
      "https://zenodo.org/api/records/6647674/files/sample_input_0.tif/content",
    ],
    additional_parameters: [
      {
        name: "Cellpose Parameters",
        parameters: [
          {
            name: "diameter",
            type: "number",
            default: 30,
            description: "Diameter of the nuclei in pixels.",
          },
          {
            name: "model_type",
            type: "string",
            default: "nuclei",
            description: "Type of cells to segment.",
            enum: ["nuclei", "cyto"],
          },
          {
            name: "flow_threshold",
            type: "number",
            default: 0.4,
            description: "Threshold for the flow.",
          }
        ],
      },
    ],
  };
  return cellposeRdf;
};


class BioEngineExecutor {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
  }

  async init() {
    const server = await hyphaWebsocketClient.connectToServer({
      server_url: this.serverUrl,
      method_timeout: 30,
      name: "client",
    });
    // this.runner = await server.getService("bioimage-io/bioimageio-model-runner");
    const bioengine = await server.getService('bioimage-io/bioengine-apps', {mode: "last"});
    this.runner = bioengine.bioimage_io_model_runner;
    console.log("Runner initialized");
  }

  async loadModelRdf(nickname) {
    try {
      const url = getArtifactFileUrl(nickname, 'rdf.yaml');
      const rdfYaml = await fetch(url).then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch RDF: ${res.status} ${res.statusText}`);
        }
        return res.text();
      });
      const rdf = yaml.load(rdfYaml);
      rdf.id = nickname;
      return rdf;
    } catch (error) {
      console.error("Error loading model RDF:", error);
      throw new Error(`Failed to load model RDF for ${nickname}: ${error.message}`);
    }
  }

  async execute(
    modelId,
    inputs = null,
  ) {
    const ret = await this.runner.infer({
      model_id: modelId,
      inputs: inputs,
      _rkwargs: true,
    });
    return ret;
  }

  // async runCellpose(array, additionalParameters = {}) {
  //   console.log("Running cellpose with parameters: ", additionalParameters);
  //   const ret = await this.runner.execute({
  //     inputs: [array, additionalParameters],
  //     model_name: "cellpose-python",
  //     decode_json: true,
  //     _rkwargs: true,
  //   });
  //   return ret;
  // }
}

export class ModelRunnerEngine {
  constructor(serverUrl = "https://hypha.aicell.io") {
    this.bioengineExecutor = new BioEngineExecutor(serverUrl);
    this.rdf = null;
    this.inputEndianness = null;
    this.modelId = null;
  }

  async init() {
    await this.bioengineExecutor.init();
  }

  getInputMinShape() {
    if (!this.rdf || !this.rdf.inputs || !this.rdf.inputs[0]) {
      throw new Error("RDF data not loaded properly");
    }
    
    const inputSpec = this.rdf.inputs[0];
    const axes = parseAxes(inputSpec); // Use the new helper
    if (!axes) {
      throw new Error("Could not parse axes information from input spec");
    }
    
    const minShape = getMinShape(inputSpec); // Use the new helper
    if (!minShape) {
      throw new Error("Could not get minimum shape from input spec");
    }
    
    // return something like {x: 64, y: 64, z: 16}
    const res = axes.split("").reduce((acc, cur, i) => {
      if (i < minShape.length) {
        acc[cur] = minShape[i];
      }
      return acc;
    }, {});
    return res;
  }

  getInputMaxShape() {
    if (!this.rdf || !this.rdf.inputs || !this.rdf.inputs[0]) {
      throw new Error("RDF data not loaded properly");
    }
    
    const inputSpec = this.rdf.inputs[0];
    const axes = parseAxes(inputSpec); // Use the new helper
    if (!axes) {
      throw new Error("Could not parse axes information from input spec");
    }
    
    const minShape = getMinShape(inputSpec); // Use the new helper
    if (!minShape) {
      throw new Error("Could not get minimum shape from input spec");
    }
    
    const maxShape = minShape.map(() => undefined);
    return axes.split("").reduce((acc, cur, i) => {
      if (i < maxShape.length) {
        acc[cur] = maxShape[i];
      }
      return acc;
    }, {});
  }

  getDefaultTileSizes() {
    const inputMinShape = this.getInputMinShape();
    const tileSizes = Object.assign({}, inputMinShape);
    const xyFactor = 4;
    // Check if x and y are defined
    if ('x' in tileSizes) {
      tileSizes.x = xyFactor * inputMinShape.x;
    }
    if ('y' in tileSizes) {
      tileSizes.y = xyFactor * inputMinShape.y;
    }
    return tileSizes;
  }

  getDefaultTileOverlaps() {
    if (!this.rdf || !this.rdf.inputs || !this.rdf.inputs[0] || !this.rdf.outputs || !this.rdf.outputs[0]) {
      throw new Error("RDF data not loaded properly");
    }
    
    const inputSpec = this.rdf.inputs[0];
    const outputSpec = this.rdf.outputs[0];
    const axes = parseAxes(inputSpec); // Use the new helper
    
    if (!axes) {
      throw new Error("Could not parse axes information from input spec");
    }
    
    let overlaps = {};
    const halo = getHalo(outputSpec); // Use the new helper
    
    if (halo) {
      axes.split("").forEach((a, i) => {
        if (i < halo.length && parseAxes(outputSpec)?.includes(a) && a !== "z") {
          overlaps[a] = 2 * halo[i];
        } else {
          overlaps[a] = 0;
        }
      });
    } else {
      overlaps = axes.split("").reduce((acc, cur) => {
        acc[cur] = 0;
        return acc;
      }, {});
    }
    return overlaps;
  }

  isImg2Img() {
    if (!this.rdf || !this.rdf.outputs || !this.rdf.outputs[0]) {
      return false;
    }
    return checkImg2Img(this.rdf.outputs[0]);
  }

  async detectInputEndianness() {
    const testInputUrl = getRdfTensorUrl(this.rdf, 'test_inputs');
    if (testInputUrl) {
      try {
        this.inputEndianness = await getNpyEndianness(testInputUrl);
        console.log("Input endianness: " + this.inputEndianness);
      } catch (error) {
        console.error("Failed to detect input endianness:", error);
        // Default to big-endian if detection fails
        this.inputEndianness = ">";
      }
    } else {
      // No test inputs available, set default endianness
      this.inputEndianness = ">";
      console.log("No test inputs available. Default endianness set to: " + this.inputEndianness);
    }
  }

  async loadModel(modelId) {
    this.modelId = modelId;
    if (modelId === "cellpose-python") {
      this.rdf = loadCellposeRdf();
    } else {
      this.rdf = await this.bioengineExecutor.loadModelRdf(modelId);
      this.detectInputEndianness();
    }
  }

  /**
   * Get URL for a file inside the current model's artifact
   * @param {string} filePath - Path to the file relative to the artifact root
   * @returns {string} Full URL to the file
   */
  getModelFileUrl(filePath) {
    if (!this.modelId) {
      throw new Error("Model ID not set, call loadModel first");
    }
    return getArtifactFileUrl(this.modelId, filePath);
  }

  async submitTensor(tensor, additionalParameters = undefined) {
    if (!this.rdf || !this.rdf.inputs || !this.rdf.inputs[0]) {
      throw new Error("RDF data not loaded properly");
    }
    
    const reverseEnd = this.inputEndianness === "<";
    const data_type = getDataType(this.rdf.inputs[0]); // Use the new helper
    const reshapedImg = tfjsToImJoy(tensor, reverseEnd, data_type);
    const modelId = this.modelId;
    let outImg;
    // if (modelId === "cellpose-python") {
    //   const resp = await this.bioengineExecutor.runCellpose(
    //     reshapedImg,
    //     additionalParameters
    //   );
    //   outImg = resp.mask;
    // } else {
    const resp = await this.bioengineExecutor.execute(modelId, reshapedImg);
    // get output tensor name 
    const outputTensorName = this.rdf.outputs[0].id;
    return resp[outputTensorName];
  }

  async runOneTensor(tensor, padder, additionalParameters = undefined) {
    if (!this.rdf || !this.rdf.outputs || !this.rdf.outputs[0]) {
      throw new Error("RDF data not loaded properly");
    }
    
    console.log("Input tile shape: " + tensor.shape);
    const [paddedTensor, padArr] = padder.pad(tensor);
    console.log("Padded tile shape: " + paddedTensor.shape);
    let outImg = await this.submitTensor(paddedTensor, additionalParameters);
    console.log("Output tile shape: " + outImg._rshape);
    const outTensor = imjoyToTfjs(outImg);
    
    const outputSpec = this.rdf.outputs[0];
    const isImageOutput = checkImg2Img(outputSpec);
    
    let result = outTensor;
    if (isImageOutput) {
      const cropedTensor = padder.crop(outTensor, padArr);
      result = cropedTensor;
    }
    return result;
  }

  /**
   * Run model with tiling strategy
   * @param {Object} tensor - Input tensor
   * @param {Object} inputSpec - Input specification
   * @param {Object} outputSpec - Output specification
   * @param {Object} tileSizes - Tile sizes for each axis
   * @param {Object} tileOverlaps - Tile overlaps for each axis
   * @param {Object|undefined} additionalParameters - Additional model parameters
   * @param {Function|undefined} reportFunc - Function to report progress
   * @returns {Promise<Object>} - Output tensor
   */
  async runTiles(
    tensor,
    inputSpec,
    outputSpec,
    tileSizes,
    tileOverlaps,
    additionalParameters = undefined,
    reportFunc = undefined
  ) {
    if (!reportFunc) {
      reportFunc = (msg) => {
        console.log(msg);
      };
    }
    
    const inputAxes = parseAxes(inputSpec); // Use the new helper
    const minShape = getMinShape(inputSpec); // Use the new helper
    const stepShape = getStepShape(inputSpec); // Use the new helper
    
    if (!inputAxes || !minShape) {
      throw new Error("Invalid input specification");
    }
    
    let padder = new ImgPadder(undefined, minShape, stepShape, 0);
    const tileSize = inputAxes.split("").map((a) => tileSizes[a]);
    const overlap = inputAxes.split("").map((a) => tileOverlaps[a]);
    
    console.log("Input tensor shape:", tensor.shape, "tile size:", tileSize, "overlap:", overlap);
    const tiler = new ImgTiler(tensor.shape, tileSize, overlap);
    const nTiles = tiler.getNTiles();
    console.log("Number of tiles in each dimension: " + nTiles);
    const inTiles = tiler.getTiles();
    console.log("Number of tiles: " + inTiles.length);
    const outTiles = [];
    for (let i = 0; i < inTiles.length; i++) {
      reportFunc(`Running the model... (${i + 1}/${inTiles.length})`);
      const tile = inTiles[i];
      console.log(tile);
      tile.slice(tensor);
      const outTensor = await this.runOneTensor(
        tile.data,
        padder,
        additionalParameters
      );
      const outTile = new ImgTile(tile.starts, tile.ends, tile.indexes);
      outTile.data = outTensor;
      outTiles.push(outTile);
    }
    
    const isImageOutput = checkImg2Img(outputSpec);
    
    let merger;
    if (isImageOutput) {
      merger = new TileMerger(tensor.shape);
    } else {
      merger = new MeanTileMerger(tensor.shape);
    }
    const res = merger.mergeTiles(outTiles).data;
    console.log("Output image shape after merging: " + res.shape);
    return res;
  }
}


