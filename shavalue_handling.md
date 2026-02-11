# SHA Value Handling Plan for Model Upload and Edit

This document outlines the logical flow for handling file SHA checksums to ensure consistency between the `rdf.yaml` metadata and the actual files stored in the artifact.

## General Principle
When creating a new model from a list of files, the `rdf.yaml` file must be uploaded first to establish the remote RDF source of truth.

The artifact maintains a **File SHA Mapping** in its metadata (manifest) which tracks the SHA256 hash of every file in the model (excluding `rdf.yaml` itself).

---

## Case 1: Uploading a New File

This workflow applies when a user explicitly uploads a new file (or overwrites an existing one via the upload interface).

1.  **Preparation**
    *   Calculate the **SHA256** hash of the local file to be uploaded.
    *   Download the latest `rdf.yaml` from the remote artifact.

2.  **Validation (SHA Check)**
    *   Scan the `rdf.yaml` for references to the file being uploaded (by filename).
    *   Compare the calculated SHA with the value stored in `rdf.yaml`.

3.  **User Interaction**
    *   **If the SHA needs updating** (file is new or different from `rdf.yaml` reference):
        *   Prompt the user: *"The file content has changed since it was last referenced in rdf.yaml."*
        *   **Option A**: Update the reference (SHA) in `rdf.yaml`.
        *   **Option B**: Abort operation.

4.  **Execution (If Option A selected)**
    *   Update the specific file's SHA value in the `rdf.yaml` content.
    *   **Upload** the new file to the artifact.
    *   **Upload** the updated `rdf.yaml` to the artifact.
    *   **Update Artifact Metadata**: Add/Update the entry for this filename in the artifact's file SHA mapping.
        *   *Note: `rdf.yaml` is never included in this mapping.*

---

## Case 2: Editing an Existing File

This workflow applies when a user edits a file directly in the application (e.g., modifying a code file or text file in the browser). **This case does not apply to editing `rdf.yaml` (see Case 3).**

1.  **Preparation**
    *   Calculate the **SHA256** hash of the edited file content.
    *   Download the latest `rdf.yaml` from the remote artifact.

2.  **Validation & Update (Silent)**
    *   Scan `rdf.yaml` for references to this filename.
    *   Update the file's SHA value in the `rdf.yaml` content to match the new content.
    *   *No user prompt is required.*

3.  **Execution**
    *   **Upload** the edited file.
    *   **Upload** the updated `rdf.yaml`.
    *   **Update Artifact Metadata**: Update the entry for this filename in the artifact's file SHA mapping.
        *   *Note: `rdf.yaml` is never included in this mapping.*

---

## Case 3: Editing `rdf.yaml`

This workflow applies when the user edits the `rdf.yaml` file itself (e.g., via the metadata editor).

1.  **Preparation**
    *   Retrieve the **File SHA Mapping** from the remote artifact's manifest (which contains the authoritative SHAs of the stored files).

2.  **Validation & Correction**
    *   Parse the locally edited `rdf.yaml`.
    *   Iterate through all file references found in the YAML.
    *   Compare the SHA in the YAML against the SHA in the remote **File SHA Mapping**.
    *   **If Mismatch**: Automatically correct the SHA in `rdf.yaml` to match the remote mapping.
    *   Track the count of corrections made.

3.  **Execution**
    *   **Upload** the updated `rdf.yaml`.
    *   *Note: The file SHA mapping in the artifact does not need updating.*

4.  **User Feedback**
    *   Display a message: *"{x} file references in the rdf.yaml did not match the actual files and were corrected."*
