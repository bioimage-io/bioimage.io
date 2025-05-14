import npyjs from "npyjs";

import { imjoyToTfjs, processForShow, inferImgAxesViaSpec, isImg2Img } from "./imgProcess";

export class ImagejJsController {
  constructor(ijObj) {
    this.ij = ijObj;
  }

  async getImage() {
    const image = await this.ij.getImage({ format: "ndarray", all: true });
    return image;
  }

  async viewFromUrl(url, inputSpec, outputSpec, type = "input") {
    console.log("View image from url: " + url);
    let fileName;
    if (url.endsWith("/content")) {
      fileName = url.split("/")[url.split("/").length - 2];
    } else {
      fileName = url.split("/")[url.split("/").length - 1].split("?")[0];
    }
    if (fileName.endsWith(".npy")) {
      let nj = new npyjs();
      const npyBuffer = await fetch(url).then((res) => res.arrayBuffer());
      const res = await nj.load(npyBuffer);
      const value = new Uint8Array(res.data.buffer.slice(res.data.byteOffset));
      const imjArr = {
        _rtype: "ndarray",
        _rdtype: res.dtype,
        _rshape: res.shape,
        _rvalue: value,
      };
      const imgAxes = inferImgAxesViaSpec(imjArr._rshape, inputSpec.axes);
      const tensor = imjoyToTfjs(imjArr);
      if (type === "output") {
        const isImageOutput = isImg2Img(outputSpec.axes);
        if (!isImageOutput) {
          //classification model
          await this.showTableFromTensor(tensor, fileName);
          return;
        }
      }
      const imgsForShow = processForShow(tensor, imgAxes);
      await this.showImgs(imgsForShow, fileName);
    } else {
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error("Failed to load the image.");
      }
      const arrayBuffer = await resp.arrayBuffer();
      this.ij.viewImage(arrayBuffer, { name: fileName }).catch((err) => {
        throw new Error("Failed to view the image.");
      });
    }
  }

  async showTableFromTensor(tensor, tableName) {
    const arrs = tensor.arraySync();
    arrs.map(async (arr) => {
      await this.showTable(arr, "Probability", tableName);
    });
  }

  async showTable(column, columnName, tableName) {
    const index = column.map((_, i) => i);
    const macro = `
Table.create("${tableName}")
Table.setColumn("Index", newArray(${index.join(",")}))
Table.setColumn("${columnName}", newArray(${column.join(",")}))
`;
    this.ij.runMacro(macro);
  }

  async showImgs(imgs, name = "output") {
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      console.log("Output image shape after processing: " + img._rshape);
      try {
        await this.ij.viewImage(img, { name: name });
      } catch (err) {
        throw new Error("Failed to view the image.");
      }
      //await this.ij.runMacro("run('Enhance Contrast', 'saturated=0.35');")
    }
  }
}
