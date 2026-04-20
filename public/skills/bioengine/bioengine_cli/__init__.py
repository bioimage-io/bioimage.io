# BioEngine CLI
# Python was chosen over Node.js (hypha-cli extension) because:
#   1. Biologists already use Python for image analysis workflows
#   2. Direct numpy/tifffile/PIL integration for image I/O without serialization overhead
#   3. Same ecosystem as the underlying hypha-rpc, bioimageio.core dependencies
#   4. hypha-cli is Node.js and adds a foreign-language dependency for biologists
#   5. The worker SDK (bioengine-worker) is Python — sharing utilities is natural

__version__ = "0.6.15"
