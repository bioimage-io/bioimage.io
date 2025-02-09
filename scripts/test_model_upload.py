import os
import httpx
import asyncio
from hypha_rpc import connect_to_server

async def interact_with_model_zoo():
    # Connect to the server
    server = await connect_to_server(
        server_url="https://hypha.aicell.io",
        token=os.environ.get("BIOIMAGEIO_API_TOKEN")  # Your authentication token
    )

    # Get the artifact manager service
    artifact_manager = await server.get_service("public/artifact-manager")

    # List available models
    models = await artifact_manager.list(
        parent_id="bioimage-io/bioimage.io",
        limit=10
    )
    print("Models in the model zoo:", len(models))

    # Get details of a specific model
    model = await artifact_manager.read(
        artifact_id="bioimage-io/affable-shark"
    )

    # List files of a specific model
    files = await artifact_manager.list_files(
        artifact_id="bioimage-io/affable-shark"
    )
    print("Files in the model:", files)

    # Download model files
    file_url = await artifact_manager.get_file(
        artifact_id="bioimage-io/affable-shark",
        file_path="weights.pt"
    )

    # Upload a new model

    # Create a manifest dictionary for the model
    # This is the RDF dictionary that will be used to create the model
    # Make sure you passed the bioimageio.spec validation before uploading the model
    model_rdf_dict = {
        "type": "model",
        "name": "My test model",
        "description": "This is a test model",
        "tags": ["test", "model"],
        "status": "request-review"
    }

    # Determine the alias pattern based on the artifact type
    alias_patterns = {
        "model": "{animal_adjective}-{animal}",
        "application": "{object_adjective}-{object}",
        "dataset": "{fruit_adjective}-{fruit}",
    }
    id_pattern = alias_patterns.get(model_rdf_dict["type"])
    
    new_model = await artifact_manager.create(
        parent_id="bioimage-io/bioimage.io",
        alias=id_pattern,
        type=model_rdf_dict["type"],
        manifest=model_rdf_dict,
        config={
            "publish_to": "sandbox_zenodo"
        },
        version="stage" # Important!
    )

    print(f"Model created with ID: {new_model.id}")

    # Upload model files
    put_url = await artifact_manager.put_file(
        artifact_id=new_model.id,
        file_path="weights.pt"
    )

    # Use put_url to upload your file
    async def upload_file(put_url, file_path):
        async with httpx.AsyncClient() as client:
            with open(file_path, 'rb') as file:
                response = await client.put(put_url, content=file)
                response.raise_for_status()
                print(f"File uploaded successfully: {response.status_code}")

    # Use put_url to upload your file
    await upload_file(put_url, "path/to/your/weights.pt")
    
    # Request for review
    new_model["manifest"]["status"] = "request-review"
    await artifact_manager.edit(
        artifact_id=new_model.id,
        version="stage",
        manifest=new_model["manifest"]
    )
    print(f"Model status updated to request-review")

    # Now you can see your model also in "My Artifacts" menu in the model zoo

if __name__ == "__main__":
    asyncio.run(interact_with_model_zoo())