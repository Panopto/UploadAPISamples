--- MultipartNodeUploadAPI.js ---

The file is a full, end-to-end sample of how to engage with the API to upload a video file into a newly created session
on a Panopto server.

- Setup

To use this file, you must have installed node.js: http://nodejs.org/download/
Once installed, you'll need to install several node.js packages. You can do this by running 'npm install <packagename>'.
The required packages are listed as includes at the top of the file
(with the notable exception of fs which is a built-in module).
It's helpful to install the packages to the same local directory in which MultipartNodeUploadAPI.js itself resides.

- Use

To invoke MultipartNodeUploadAPI.js, call 'node MultipartNodeUploadAPI.js', optionally with arguments.
The arguments, with defaults, are listed in order near the top of the file.
Some of the defauls are examples, so change them to meaninful defaults as desired.

MultipartNodeUploadAPI.js logs into the specified site, creates a new session under the specified folder.
It then uploads a single specified file to that session and queues it for processing.
It is possible to upload any number of files to any session. That session might already exist.
Consider this as an example of the simplest possible complete use case.

The upload sequence might fail for any number of reasons:
authentication problems, unacceptable file formats, internet latency, etc.
The sample does only a mimimum of error detection and retry.




--- MultipartUploadClient.js/htm ---

This is an example of a plain javascript/html client which can upload any filetype to a Panopto server.

- Setup

Load the htm file in any browser. The javascript file should be in the same directory as the html file.

- Use

In order for the file upload to work, an open upload upload must have been requested using the API.
See the node sample or API documentation for how to do this.

Once such an upload has been requested, put the targetURI handed back by the API into the targetURI field.
Choose a local file to upload the desired slice size to upload.
The upload process can be performed for as many files and as many times as desired.
An existing file will be overwritten by a new upload of the same filename.
The process can be reattempted as many times as desired in the event of any errors.

In order to queue processing of the newly uploaded file(s), call the API to signal the upload is complete.
See the node sample or API documentation for how to do this.
