var Panopto = Panopto || {};
Panopto.MultipartUpload = (function () {

    // wrap a jQuery ajax call to expose this functionality in a library-independent fashion
    var makeRestCall = function(method, uri, body, onComplete, onError) {
        // invoke JQuery's ajax to make the call
        $.ajax({
            url: uri,
            type: method,
            data: body,
            processData: false,     // need to send raw bytes to the server
            success: function (data, textStatus, jqXhr) {
                if (onComplete) {
                    parseJqXhr(jqXhr, function (status, xml, headers) {
                        onComplete(xml, headers);
                    });
                }
            },
            error: function (jqXhr, textStatus, errorThrown) {
                if (onError) {
                    parseJqXhr(jqXhr, onError);
                }
            }
        });
    };

    // a helper to unpack the headers and body of the response as exposed by jQuery
    var parseJqXhr = function(jqXhr, onParse) {
        var status = [jqXhr.status, jqXhr.statusText].join(' ');
        var xml = new DOMParser().parseFromString(jqXhr.responseText, "application/xml");
        var headers = objectifyDomString(jqXhr.getAllResponseHeaders());

        onParse(status, xml, headers);
    };

    // in order to easily parse headers, take the DOMString and make it an object
    var objectifyDomString = function(domString) {
        var pairs = {};

        // domString name-value pair collection is newline delimitted
        // but the escape characters don't seem to be working; use the char code for newline (10) directly instead
        var maps = domString.split(String.fromCharCode(10));
        for (var map = 0; map < maps.length; map++) {

            // split on colons to separate names from values
            var splits = maps[map].trim().split(':');
            if (splits.length > 1) {

                // first element is the key
                // value may have had colons (e.g. timestamps) so rejoin rest of array as necessary
                // trim both since DOMStrings tend to pad a little whitespace for readability
                pairs[splits[0].trim()] = splits.slice(1).join(':').trim();
            }
        }

        return pairs;
    };

    // bytes are too small, instead show some number of megabytes
    var toMegs = function(numBytes) {
        var megs = numBytes / (1024 * 1024);
        if (megs != parseInt(megs)) {
            megs = megs.toFixed(3);
        }
        return megs;
    };

    // perform the entire upload end-to-end, invoking onUpdate(message) if provided as component steps are completed
    // for finer control over the upload process, implement this using the more basic APIs to accomplish that end
    var uploadFile = function(targetUri, file, sliceSize, onComplete, onError, onUpdate) {
        // set up the upload on the server
        open(
            targetUri,
            file.name,
            function(uploadId) {
                if (onUpdate) {
                    onUpdate(["Upload opened for ", toMegs(file.size), " MB file with uploadId ", uploadId, "."].join(''));
                }

                // split the file into slices and put them up to the server
                uploadFileInSlices(
                    targetUri,
                    file,
                    sliceSize,
                    function(eTags) {
                        if (onUpdate) {
                            // eTags is a 1-based array
                            onUpdate(eTags.length - 1 + " parts uploaded successfully.");
                        }

                        // indicate that the upload is complete to the server
                        close(
                            targetUri,
                            file.name,
                            uploadId,
                            eTags,
                            function(xml) {
                                // indicate the upload was completed by the server
                                if (onUpdate) {
                                    onUpdate("Upload completed successfully.");
                                }
                                if (onComplete) {
                                    onComplete(xml);
                                }
                            },
                            onError
                        );
                    },
                    onError,
                    function(index, sliceCount, sliceSize, eTag) {      // onUpdate for each slice
                        // indicate that this slice was successfully uploaded
                        if (onUpdate) {
                            onUpdate(["Part ", index, " of ", sliceCount, " (", toMegs(sliceSize), " MB) uploaded with eTag ", eTag].join(''));
                        }
                    }
                );
            },
            onError
        );
    };

    // open an upload, invoke onComplete(uploadId, xmlResponse)
    var open = function(targetUri, filename, onComplete, onError) {
        makeRestCall(
            'POST',
            targetUri + filename,
            undefined,	// no body in initial request
            function (xml) {
                onComplete(xml.getElementsByTagName('UploadId')[0].childNodes[0].nodeValue, xml)
            },
            onError);
    };

    // put a single blob of data to the specified filename and index, invoke onComplete(eTag)
    var uploadBlob = function(targetUri, filename, index, blob, onComplete, onError) {
        var reader = new FileReader();
        reader.onload = function (evt) {
            var fullUri = [targetUri, filename, "?partNumber=", index].join('');
            makeRestCall(
                'PUT',
                fullUri,
                new DataView(evt.target.result),
                function (xml, headers) {
                    onComplete(headers['ETag']);
                },
                onError
            );
        }
        reader.readAsArrayBuffer(blob);
    }

    // slice out the blob in [startByte, startByte + sliceSize) from the file and upload it to indexth position
    // invoke onComplete with actual slice size obtained and status from uploadBlob
    var uploadSlice = function(targetUri, file, index, startByte, sliceSize, onComplete, onError) {
        var blob = file.slice(startByte, startByte + sliceSize);
        uploadBlob(
            targetUri,
            file.name,
            index,
            blob,
            function (eTag) { onComplete(blob.size, eTag) },
            onError);
    }

    // slice up a file into file.size/sliceSize pieces and call uploadSlice on each; invoke onComplete(eTags)
    // if onUpdate is provided, invoke onUpdate(index, sliceCount, blobSize, eTag) as each slice is successfully uploaded
    var uploadFileInSlices = function(targetUri, file, sliceSize, onComplete, onError, onUpdate) {
        var sliceCount = Math.ceil(file.size / sliceSize);

        // define and invoke a recursive function to put up the slices in order
        (function uploadFileHelper(eTags, startByte, index) {
            // base case is we've reached (at least) the end of the file, so return the sliceRecords
            if (startByte >= file.size) {
                onComplete(eTags);
            }
            else {
                // general case is we need to upload the slice of the file in [startByte, startByte + sliceSize)
                uploadSlice(
                    targetUri,
                    file,
                    index,
                    startByte,
                    sliceSize,
                    function (blobSize, eTag) {
                        if (onUpdate) {
                            onUpdate(index, sliceCount, blobSize, eTag);
                        }

                        // save the eTag of the slice we just pushed and move to the next one
                        eTags[index] = eTag;
                        uploadFileHelper(eTags, startByte + blobSize, index + 1);
                    },
                    onError);
            }
        })([], 0, 1);
    }

    // indicate that the file called filename, allowed upload with uploadId, and fragmented as specified with eTags is complete
    // invoke onComplete(responseXml)
    var close = function(targetUri, filename, uploadId, eTags, onComplete, onError) {
        var fullUri = [targetUri, filename, "?uploadId=", uploadId].join('');

        // prepare eTag xml; eTags array is 1-based
        for (var index = 1; index < eTags.length; index++) {
            eTags[index] = ['<Part><PartNumber>', index, '</PartNumber><ETag>', eTags[index], '</ETag></Part>'].join('');
        }

        makeRestCall(
            'POST',
            fullUri,
            ['<CompleteMultipartUpload>', eTags.join(''), '</CompleteMultipartUpload>'].join(''),
            function (xml, headers) { onComplete(xml) },
            onError
        );
    }

    // hand back the functions designed to be publicly exposed
    return {
        // minimal functionality to interface with server
        open: open,
        uploadBlob: uploadBlob,
        close: close,
        // some higher level APIs which ultimately call uploadBlob
        uploadSlice: uploadSlice,
        uploadFileInSlices: uploadFileInSlices,
        // a full e2e API which calls open, uploadFileInSlices, and close
        uploadFile: uploadFile
    }
})();
