// Panopto Upload API example for Panopto 4.6.1
var util = require('util');
var fs = require('fs');
var path = require('path');
var request = require('request');
var parseXMLString = require('xml2js').parseString;

var Panopto = Panopto || {};

Panopto.testUploadAPI = (function () {

    // Command line or defaults, taken in order
    var host = process.argv[2] || "https://demo.hosted.panopto.com" ; // https - Unison licensed server
    var fileLocation = process.argv[3] || "c:\\someDirectory\\someFile.ext"; // The file to upload; relative or absolute path
    var sessionName = process.argv[4] || "testSessionName";
    var username = process.argv[5] || "admin"; // User name with a unison license
    var password = process.argv[6] || "password1"; // User's password
    // You need the guid of the parent folder for your session
    // This can be found on the folder manage modal - Folder id
    // Every session needs a parent folder so this is a necessary step 
    // when creating a new session. Also be sure the user has permission to upload to this folder
    var ParentFolderID = process.argv[7] || "12345678-abcd-0246-1357-123456789abc";
    // This allows connections to servers with bad certs
    // Default is to allow bad certificates
    var rejectBadCerts = process.argv[8] === 'true';

    var filePath = path.relative('./', fileLocation);
    var fileName = path.basename(filePath);
    var APIPath = host + "/Panopto/PublicAPISSL/REST/";
    // Minimum 5MB per chunk (except the last part) http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadComplete.html
    var sliceMbs = 5;
    // A flag used to determine if we should retry 
    var retry = true;

    var restHeaders = {
        'User-Agent': ' Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/34.0.1847.137',
        'Accept-Language': 'en-US,en;q=0.8,zh-CN;q=0.6,zh;q=0.4,fr;q=0.2,ko;q=0.2,es;q=0.2',
        'Accept-Encoding': ' gzip,deflate,sdch',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.7',
        'Content-Type': "application/json; charset=utf-8",
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    };

    var uploadHeaders = {
        'User-Agent': ' Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/34.0.1847.137',
        'Accept-Language': 'en-US,en;q=0.8,zh-CN;q=0.6,zh;q=0.4,fr;q=0.2,ko;q=0.2,es;q=0.2',
        'Accept-Encoding': ' gzip,deflate,sdch',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.7',
        'Content-Type': "video/mpeg;",
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    };

    var soapLoginString = util.format(
        "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\">" +
        "<s:Body><LogOnWithPassword xmlns=\"http://tempuri.org/\">" +
        "<userKey>%s</userKey><password>%s</password></LogOnWithPassword></s:Body>" +
        "</s:Envelope>",
        username,
        password);

    var soapHeaders = {
        'SOAPAction': 'http://tempuri.org/IAuth/LogOnWithPassword',
        'Content-Type': 'text/xml; charset=utf-8'
    };

    // Get login cookie from server
    var getAuthCookie = function (onComplete) {
        request({
            url: host + "/Panopto/PublicAPI/4.2/Auth.svc",
            headers: soapHeaders,
            method: 'POST',
            rejectUnauthorized: rejectBadCerts,
            body: soapLoginString
        },
        function (error, response, body) {
            var authCookie;

            if (error) {
                console.log("Unable to log in");
            } else {
                // Check login success by seeing if set-cookie exists
                if (response.headers['set-cookie']) {
                    authCookie = response.headers['set-cookie'][0];

                    // Add the cookie to our headers
                    uploadHeaders['Cookie'] = authCookie;
                    restHeaders['Cookie'] = authCookie;

                    onComplete();
                } else {
                    console.log('bad user credentials');
                }
            }
        });
    };

    // Creates a session
    var createSession = function (onComplete) {
        request({
            url: APIPath + 'session',
            headers: restHeaders,
            method: 'POST',
            rejectUnauthorized: rejectBadCerts,
            json: true,
            body: {
                ParentFolderID: ParentFolderID,
                Name: sessionName
            }
        },
        function (error, response, body) {

            if (error) {
                console.log("Error creating session")
            } else {
                onComplete(body);
                console.log("session created");
            }
        });
    };

    // Creates the upload job
    var createUpload = function (deliveryID, onComplete) {
        request({
            url: APIPath + 'upload',
            headers: restHeaders,
            method: 'POST',
            rejectUnauthorized: rejectBadCerts,
            json: true,
            body: {
                SessionID: deliveryID,
                UploadTarget: sessionName
            }
        },
        function (error, response, body) {

            if (error) {
                console.log('Error creating upload job');
            } else {
                onComplete(body);
            }
        });
    };

    // Uploads a file once the job is made
    var uploadFile = function (targetUri, filePath, onUploadComplete, onError, onUpdate) {

        var sliceSize = 1024 * 1024 * sliceMbs;

        // Useful to know whether the file exists
        fs.exists(filePath, function (exists) {
            console.log(exists ? "file found" : "file not found");
        });

        // Read the file synchronously
        var fileStats = fs.statSync(filePath);

        // Open
        var open = function (targetUri, sessionName, onComplete, onError) {
            request({
                url: targetUri + "/" + sessionName,
                method: 'POST',
                rejectUnauthorized: rejectBadCerts,
                json: true
            },
            function (error, response, body) {
                if (error && onError) {
                    onError(error);
                }
                parseXMLString(body, function (error, result) {
                    if (error) {
                        console.log('error parsing xml');
                    } else {
                        onComplete(result, sessionName);
                    }
                });
            });
        };

        // put a single blob of data to the specified sessionName and index, invoke onComplete(eTag)
        var uploadBlob = function (targetUri, fileBlob, index, portion, onSuccess, onError) {
            var fullUri = [targetUri, "/" + fileName, "?partNumber=", index].join('');

            fs.createReadStream(filePath, portion).pipe(
                request({
                    url: fullUri,
                    method: 'PUT',
                    rejectUnauthorized: rejectBadCerts,
                    json: true
                },
                    function (error, response, body) {

                        if (error && onError) {

                            // This often occurs when a server is slow to respond
                            if (error && retry) {
                                retry = false;
                                // retry upload once
                                console.log(error + ' while uploading slice ..retrying');
                                uploadBlob(targetUri, fileBlob, index, portion, onSuccess, onError);
                            } else {
                                // Common cause includes server timing out or not responding
                                onError(error);
                            }
                        } else {
                            // Reset retry
                            retry = true;
                            onSuccess(response.headers.etag);
                        }
                    }
            ));
        };

        var uploadSlice = function (targetUri, fileStats, sessionName, index, startByte, sliceSize, onComplete, onError) {
            var endByte = Math.min(startByte + sliceSize, fileStats.size);

            console.log('uploading slice ', startByte, endByte);

            uploadBlob(
                targetUri,
                sessionName,
                index,
                // Start and end of where to read the file
                {
                    start: startByte,
                    end: endByte
                },
                function (eTag) {
                    onComplete(endByte - startByte, eTag);
                },
                onError
            );
        };

        var uploadFileInSlices = function (targetUri, fileStats, sessionName, sliceSize, onComplete, onError, onUpdate) {
            var sliceCount = Math.ceil(fileStats.size / sliceSize);

            // define and invoke a recursive function to put up the slices in order
            (function uploadFileHelper(eTags, startByte, index) {

                // base case is we've reached (at least) the end of the file, so return the sliceRecords
                if (startByte >= fileStats.size) {
                    onComplete(eTags);
                } else {
                    // general case is we need to upload the slice of the file in [startByte, startByte + sliceSize)
                    uploadSlice(
                        targetUri,
                        fileStats,
                        sessionName,
                        index,
                        startByte,
                        sliceSize,
                        function (blobSize, eTag) {
                            if (onUpdate) {
                                onUpdate(index, sliceCount, blobSize, eTag);
                            }

                            // Check that we have a proper eTag and not undefined
                            if (eTag) {
                                // save the eTag of the slice we just pushed and move to the next one
                                eTags[index] = eTag;
                                uploadFileHelper(
                                    eTags,
                                    // Add one so that our start byte is the byte after the last slice's end byte
                                    startByte + blobSize + 1,
                                    index + 1);

                                // If we do not have an eTag then exit 
                            } else {
                                console.log("Recieved undefined eTag, exiting.");
                                onError();
                            }
                        },
                        onError);
                }
            })([], 0, 1);
        };

        var close = function (targetUri, sessionName, uploadId, eTags, onComplete, onError) {

            var fullUri = [targetUri, "/", fileName, "?uploadId=", uploadId].join('');

            // prepare eTag xml; eTags array is 1-based
            // eTag may have double quotation marks and those should be escaped.
            for (var index = 1; index < eTags.length; index++) {
                eTags[index] = ['<Part><PartNumber>',
                                index,
                                '</PartNumber><ETag>',
                                eTags[index].replace(/"/g, '&quot;'),
                                '</ETag></Part>'].join('');
            }

            request({
                url: fullUri,
                method: 'POST',
                json: false,
                rejectUnauthorized: rejectBadCerts,
                body: ['<CompleteMultipartUpload>', eTags.join(''), '</CompleteMultipartUpload>'].join(''),
            },
                function (error, response, body) {
                    if (error) {
                        onError(error);
                    } else {
                        parseXMLString(body, function (error, result) {
                            if (result.CompleteMultipartUploadResult) {
                                onComplete(uploadId);
                            } else {
                                console.log('Error closing upload');
                            }
                        });
                    }
                }
            );
        };

        // Execute the whole multipart upload sequence 
        open(
            targetUri,
            sessionName,
            function (result, sessionName) { // onComplete

                // split the file into slices and put them up to the server
                uploadFileInSlices( // Upload the slices
                    targetUri,
                    fileStats,
                    sessionName,
                    sliceSize,
                    function (eTags) { // onComplete

                        // indicate that the upload is complete to the server
                        close( // Finish the upload
                            targetUri,
                            sessionName,
                            result.InitiateMultipartUploadResult.UploadId[0],
                            eTags,
                            onUploadComplete,
                            console.log // log error
                        );
                    },
                    console.log, // log error,
                    console.log // log update info 
                );
            }
        );
    }

    // Begins processing on the upload
    var processSession = function (deliveryID, uploadId, target, onComplete) {
        // Code for a completed upload
        var StateUploadCompleted = 1;

        // Creates an upload
        request({
            url: APIPath + 'upload/' + uploadId,
            headers: restHeaders,
            method: 'PUT',
            json: true,
            rejectUnauthorized: rejectBadCerts,
            body: {
                SessionID: deliveryID,
                ID: uploadId,
                UploadTarget: target,
                State: StateUploadCompleted
            }
        },
        function (error, response, body) {

            if (error) {
                console.log(error);
            } else {
                onComplete();
            }
        });
    };

    // Here is where we string all the calls together. First we are creating a session
    // to upload to. Then we are making a call to create an upload job in the DB.
    // Next we upload the file itself. This has a few parts so we encapsulate the process
    // in the createUpload function. Finally we make a call to let the DB know the
    // upload is complete and it should begin processing the upload.


    // Get the auth cookie so that we have credentials to make our calls.
    // Its important that the user you are logging in as has permission to upload files
    // and that the server has been licensed to allow uploading.
    getAuthCookie(function () {
        // Create a session first so that we have somewhere to put our upload
        // You wouldn't need this step if you where uploading to a session that already exists
        createSession(function (data) {
            var deliveryID = data.ID;

            // Create the upload job in the DB. Pass in the delivery id of the session you would like to upload to.
            createUpload(deliveryID, function (data) {
                var uploadTarget = data.UploadTarget;

                console.log('upload target', data.UploadTarget);
                var uploadID = data.ID;

                // Begin the upload itself. This function encapsulates a few calls.
                uploadFile(uploadTarget, filePath, function () {

                    // Finally begin processing the uploaded file in the session this is
                    // the final call and if you open the webUI shortly after this call is
                    // made you should see that processing has been queued up in the session list.
                    // After processing completes you should be able to play the video you uploaded.
                    processSession(deliveryID, uploadID, uploadTarget, function () {
                        console.log('Upload completed successfully');
                    });
                });
            });
        });
    });

})();
