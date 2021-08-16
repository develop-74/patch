(function(){
	var V = VideoMost;
	V.RTCConnectionClass = RootClass.New({
		TAG: 'RTCConnectionClass',
		// { // abag : FF bug workaround (fixed in FF v59 (58?))
		//FF_MAX_PARTS_COUNT: null, // 6,
		// }
		
		useReturnCall: true, // abag
		queue: null,
		
		videoOnly: false,
		upMSectObjMap: null, // array of upSdpMsectObj; index is an order in sdp // abag sharing3
		
		/**
		 * speaker device id got by enumerateDevices
		 * null - for default device
		 */
		_audioOutDeviceId: null,
		_pendingAddSsrc: null,
		_savRemoteSdpObj: null,
		_savedSsrcs: null,
		_transportData: null,
		_useVideoMixer: false, //true, // abag 06.11.2017 = video mixer
		_wrtcStats:null,
		_spectrum:null,
		_ssrcJidMap:{}, // _ssrcJidMap[ssrc]==jid
		_useAVMux:false,
		_useAbsSendTime:false,
		_useTwccExtId:false,
		_maxBweBitrate:10000,
//		pcQueue: null,
//		_pc:null,
		video_resolution: {}, //default res
		
		getOwnJid: function() {
			return this._jmate._opt.users._mylogin;
		},
		_workaround_SAF_001: true,

		getOfferConstraints: function () {
			if (V.interopSDPClass.isFirefox()) {
				return this.offerconstraints_FF;
			} else if (V.interopSDPClass.isChrome()) {
				return this.offerconstraints_Chrome;
			} else if (V.interopSDPClass.isSafari()) {
				return this.offerconstraints_Safari;
			}
		},
		peerconstraints: {
			optional: [{DtlsSrtpKeyAgreement: false},
						{googIPv6: false},
						{googDscp: true}]  // QoS related
		},
		
		_serverConfig: {
//			iceTransportPolicy:'relay', // allow TURN candidates only
			sdpSemantics:null, //"plan-b", "unified-plan" // will be overriden in init()
		},
		/**
		 * @memberOf RTCConnectionClass
		 */
		init: function(conf){
			this._jmate = conf.jmate;

			if (V.interopSDPClass.isChrome()) {
				this._serverConfig.sdpSemantics = V.interopSDPClass.usesUnifiedPlan() ? "unified-plan" : "plan-b";
			} else {
				delete this._serverConfig.sdpSemantics;
			}

			// use DTLS or SRTP (affected to Chrome engine browsers only)
			this.peerconstraints.optional[0].DtlsSrtpKeyAgreement = !V.interopSDPClass.usesCrypto();

			this._useVideoMixer = false;
			this._connection = conf.connection;
			
			this.upMSectObjMap = []; // abag sharing3
			this._pendingAddSsrc = {};
			
			this.queue = V.QueueClass.New().init();
			this.fful = V.FirefoxUserListClass.New().init(this);
			this._wrtcStats = V.WrtcLiveStatsClass.New().init(this);
			// Workaround _workaround_SAF_001 : onremovetrack handler is not called by Safari.
			this._workaround_SAF_001 = V.interopSDPClass.isSafari();

			return this;
		},
		start: function(jid){
			this.remoteJid = jid;
			this.initiator = jid;//this._connection.jid;
			
			this._pendingAddSsrc = {};			
			this._savRemoteSdpObj = null;
			this._savedSsrcs = null;
			this._transportData = { tr:[], ice: {} };
// 			this._transportData = null;
			
			this.queue.stopQueue();
			this.buildTransport();
		},
		
		serverIQ: null,

		// offerAnswerType = {"offer", "answer"}
		// returns Promise
		// initialOfferMSections_ - порядок m-секций в самом первом оффере (из setSDPsWarmup)
		setSDPs: function (sdpObjPB, trObj, offerAnswerType, initialOfferMSections_) {
			V.log('setSDPs: ', sdpObjPB, trObj,'warn');
			var that = this;
			//apply sdp

			// abag : Plan B to Unified plan (for FireFox)

			// to Unified Plan (FF) both for offer and answer
			// Плюс для answer оставим столько m-секций, сколько было в первоначальном offer, т.е. 2 штуки
			// Иначе firefox не даст сделать answer.
			var sdpObj = this._jmate._interopSDP.toUnifiedPlan(this.upMSectObjMap, sdpObjPB, that.getRemoteFingerprintObj(), this.videoOnly, null);
			this._jmate._interopSDP.rebuildBundlesInObj(sdpObj, this._useAVMux);
			this._jmate._interopSDP.assignDtlsSetups(sdpObj, "offer");
			if (initialOfferMSections_) {
				this._jmate._interopSDP.adjustMSectionsOrderInObj(sdpObj, initialOfferMSections_);
			}
			// Actualy this is for tricke ICE
			if (V.interopSDPClass.isFirefox() || V.interopSDPClass.isSafari()) {
			//if (V.interopSDPClass.isFirefox()) {
			//if (V.interopSDPClass.usesUnifiedPlan()) {
				if (offerAnswerType == "offer") {
					sdpObj = vmSDP.AddEndOfCandidatesToObj(sdpObj);
				}
			}
			// }

			// abag - working with sdp objs
			sdpObj = that.SetSendingBandwidth(sdpObj);
			var sdpText = Phono.sdp.buildSDP(sdpObj);

//			vmSDP.dumpCol('SDPDBG: GOT SDP', sdpText);
			var sd = WRTCA.mkSessionDescription({
				'sdp': sdpText,
				'type': offerAnswerType //"answer", "offer"
			});

			var pc = this._peerConnection;
			vmSDP.dumpSDP2('DBG SAF001 ' + pc.debugTag + ' | ***** setSDPs remote SDP, type = ' + sd.type + ' : ', 'DBG SAF001: ', sd.sdp);

/***        // Это тоже работающий вариант
			return new Promise(function(resolve, reject) {
                that.WaitForState('stable').then(function() {
                    pc.setRemoteDescription(sd).then(function() {
                            V.log(pc.debugTag + "remoteDescription happy");
                            that.WaitForState('have-remote-offer').then(function() {
							that.setLocalDescOnOffer().then(
									function() {resolve();},
                                    function(err) {
                                        V.log(pc.debugTag + " setLocalDescOnOffer failed" + err, 'error');
                                        reject(err);
                                    });
                            }).catch(function(err) {
                                V.log(pc.debugTag + " WaitForState failed" + err, 'error');
                                reject(err);
                            });
						},
						function (err) {
							V.log(pc.debugTag + " remoteDescription sad " + err, 'error');
							reject(err);
                        });
                });
            });
***/
        	return that.WaitForState('stable')
            	.then(function() {
            		return pc.setRemoteDescription(sd);
            	})
            	.then(function() {
            		V.log(pc.debugTag + "remoteDescription happy");
            		return that.WaitForState('have-remote-offer');
            	})
            	.then(function() {
            		return that.setLocalDescOnOffer();
            	})
            	.catch(function(err) {
            		V.log(pc.debugTag + " setSDPs failed" + err, 'error');
            	});
		},


		setLocalDescOnOffer: function () {
			var that = this;

			return new Promise(function(resolve, reject) {
				that._peerConnection.createAnswer().then(
						function (description) {
							var sdpCut = description;
							// Remove all extra shit from the SDP (unsupported FEC, trickle ICE, ...)
							sdpCut.sdp = vmSDP.TuneLocalSdp(sdpCut.sdp);
							vmSDP.dumpSDP2('DBG SAF001 ' + that._peerConnection.debugTag + ' | ***** setLocalDescOnOffer remote SDP, type = ' + sdpCut.type + ' : ', 'DBG SAF001: ', sdpCut.sdp);

							that._peerConnection.setLocalDescription(sdpCut).then(
									function () { // ok
										resolve();
									},
									function (err) { // fail
										V.log('[setLocalDescOnOffer] : failed to setLocalDescription) ', err, "error");
										reject(err);
									}
							);
						},
						function (err) {
							V.log('[setLocalDescOnOffer] : setSDPs() failed : ', err);
							reject(err);
						});
			});
		},


		// Videomost server не работает в режиме DTLS-server (только DTLS-клиент) из-за внутренних ошибок,
		//  но Safari не разрешает запуск DTLS negotiation, если browser находится в режиме DTLS-server и
		//  браузер - offer (SetLocalDescripion()). Поэтому мы сначала сделаем браузер оффером, запустим DTLS,
		//  а затем вернемся к VM-offer/Browser-answer модели, как было раньше.
		setSDPsWarmup: function (offerOpts_, rmtSdpObjPB_, trObj_) {
			var that = this;
			V.log('DBG SAF002 [using local REOFFER] setSDPsWarmup: ', rmtSdpObjPB_, trObj_, "info");

			return new Promise(function (resolve, reject) {
				var pc = that._peerConnection;
				var debugTag = pc.debugTag;

				pc.createOffer(offerOpts_).then(function (localSdp) {
					pc.setLocalDescription(localSdp).then(
							function () { // ok
								vmSDP.dumpSDP2('DBG SAF001 ' + pc.debugTag + ' | ***** Initial local SDP, type = ' + localSdp.type + ' : ', 'DBG SAF001: ', localSdp.sdp);

								//localSdp.sdp = vmSDP.TuneLocalSdp(localSdp.sdp);
								// upMSectObjMap must contain m-sections history for the all offers, as local either remote ones.
								//that.upMSectObjMap = that._jmate._interopSDP.createUpMSectObjMapFromSdpText(localSdp.sdp);
								var initialOfferMSections = that._jmate._interopSDP.getMSectionsFromSdpText(localSdp.sdp);
								var sdpObj = that._jmate._interopSDP.toUnifiedPlan(that.upMSectObjMap, rmtSdpObjPB_,
										that.getRemoteFingerprintObj(), that.videoOnly, initialOfferMSections);
								that._jmate._interopSDP.rebuildBundlesInObj(sdpObj);
								that._jmate._interopSDP.assignDtlsSetups(sdpObj, "answer");
								// Actualy this is for tricke ICE
								//if (V.interopSDPClass.isFirefox()) {
								if (V.interopSDPClass.isFirefox() || V.interopSDPClass.isSafari()) {
									sdpObj = vmSDP.AddEndOfCandidatesToObj(sdpObj);
								}
								//that.AddRemoteIceCandidates(trObj_, sdpObj);

								sdpObj = that._jmate._interopSDP.fixAnswerSdpObjByOfferSdpText(localSdp.sdp, sdpObj);
								var remoteSdpText = Phono.sdp.buildSDP(sdpObj);
								//remoteSdpText = that._jmate._interopSDP.fixAnswerSdpByOffer(localSdp.sdp, remoteSdpText);

								var sd = WRTCA.mkSessionDescription({
									"sdp": remoteSdpText,
									"type": "answer"
								});

								vmSDP.dumpSDP2('DBG SAF001 ' + pc.debugTag + ' | ***** Initial remote SDP, type = ' + sd.type + ' : ', 'DBG SAF001: ', sd.sdp);

								pc.setRemoteDescription(sd).then(
									function(result) {
										V.log("initial remoteDescription happy");
										that.AddRemoteIceCandidates(trObj_, sdpObj);
										resolve({sdp:localSdp.sdp, ioms:initialOfferMSections});
									},
									function(err) {
										V.log(debugTag + " initial remoteDescription sad " + err, 'error');
										reject(err);
									});
							},
							function (err) { // fail
								V.log(debugTag + " initial setLocalDescription sad : " + err, "error");
								reject(err);
			}
					);
				},
				function (err) { // fail
					V.log(debugTag + " initial createOffer sad : " + err, "error");
					reject(err);
				});
			});
		},
		
		removeSsrcsFromSdpObj: function (blobSdpObj_, ssrcList_) {
			V.log("removeSsrcsFromSdpObj : " + ssrcList_.join(", "),'debug');
			var removedSmth = false;

			for (var i = 0; i < blobSdpObj_.contents.length; i++) {
				var sdpObj = blobSdpObj_.contents[i];
				var newSsrcs = [];

				var foundSmth = false;
				for (var j in sdpObj.ssrcs) {
					var found = false;
					for (var u in ssrcList_) {
						if (sdpObj.ssrcs[j].ssrc == ssrcList_[u]) {
							found = foundSmth = true;
							break;
						}
					}

					if (!found) {
						newSsrcs.push(sdpObj.ssrcs[j]);
					}
				}

				if (foundSmth) {
					sdpObj.ssrcs = newSsrcs;
				}
				removedSmth = foundSmth;
			}
			return removedSmth;
		},


		// abag
		getActiveMlinesCount: function(mtype_) {
			var rsdp = this._peerConnection.remoteDescription;
			vmSDP.dumpCol('DBG001 getActiveMlinesCount remote sdp : ', rsdp.sdp);

			var sdpLines = rsdp.sdp.split("\r\n");
			var count = 0;

			// Count active && inactive m-sections
			for (var i = 0; i < sdpLines.length; i++) {
				var line = sdpLines[i];
				if (line.indexOf('m=') === 0) {
					var mtype = line.split("=")[1].split(" ")[0];
					//var mtype = mm[1];
					if (mtype_ === null || mtype == mtype_) {
						count++;
					}
				}
			}

			return count;
		},
		
		//====
		addSsrc: function(s){
			V.log(this.TAG, 'addSsrc:', s, 'log');

			var that = this;
			//if already pending, dont make new promise
			var dontpromise = !!Object.keys(this._pendingAddSsrc).length;
//        	V.log('add pending ssrc job', s,'warn');
			//add stream info to pending linst
			this._pendingAddSsrc[s.id+'/'+s.t] = s;
			this._ssrcJidMap[s.s] = s.id;
			
			if(dontpromise) 
				return;
//        	V.log('add ssrc job', this._pendingAddSsrc,'warn');
			this.queue.addJobToQueue(that.processNewSsrc.bind(that));
		},
		/**
		 * @param {Object} slist {id:party.Login, t:type, s:s, c:c}
		 */
		processNewSsrc: function(end){
			//on ok fin call okcb(), otherwise errcb()
			var slist = this._pendingAddSsrc;
//			V.log('SDPDBG: processNewSsrc list:', JSON.stringify(slist));
			V.log('processNewSsrc:', slist,'log');
			this._pendingAddSsrc = {}; //reset pending list
			
			var that = this;
			//-----------------------------
			var setSDPsLocal = function () {
				//V.log('2020: processNewSsrc:', slist);
				// Adding a==ssrc parts for the object
				that.addSsrcsToSdpObj(that._savRemoteSdpObj, that._savedSsrcs);
				that.setSDPs(that._savRemoteSdpObj, that._transportData.tr, "offer").then(
						function (isOk) {end();},
						function () {end();}
				);
			};

			that._savedSsrcs = {}; // { mediaType, ssrc }
			var initSsrcsItem = function (savedSsrcs_, peerid_, mtype_) { //, ssrc_) {
				if (!savedSsrcs_[peerid_]) {
					savedSsrcs_[peerid_] = {};
				}
				if (!savedSsrcs_[peerid_][mtype_]) {
					savedSsrcs_[peerid_][mtype_] = {};
				}
				return savedSsrcs_[peerid_][mtype_];
			};

			// Сохраним ssrc & cname, полученные через модер.атрибуты
			for (var u in slist) {
				var sinfo = slist[u];
				
				var saved = initSsrcsItem(that._savedSsrcs, sinfo.id, sinfo.t);
				saved.ssrc = sinfo.s;
				saved.msidext = sinfo.id;
				saved.cname = sinfo.c;

//                V.log("Stream ADDED:", sinfo.t, sinfo.s + "/" + sinfo.c,'debug');
			}

			if (V.interopSDPClass.usesCrypto()) {
				// Chrome uses Crypto and no DTLS
				setSDPsLocal();
			} else {
				// Firefox uses DTLS & fingerprint
				this.WaitForFingerprints().then(
					function (result) {
						V.log("fngPromise (2) result : " + result,'debug');
						setSDPsLocal();
					},
					function (error) {
						V.log("fngPromise (2) error : " + error,'debug');
						setSDPsLocal();
					}
				);

			}
		},

		//=============================
		// abag
		DeleteSsrcs: function (ssrcsToRemove) {
			var that = this;

			var toRemove = this.removeSsrcsFromSdpObj(this._savRemoteSdpObj, ssrcsToRemove);
			if (toRemove) {
				V.log('DeleteSsrcs:', ssrcsToRemove,'log');
				this.queue.addJobToQueue(function(end){
					that.setSDPs(that._savRemoteSdpObj, that._transportData.tr, "offer").then(
							function(isOk) {end();},
							function(err) {end();}
					);
				});
			}
		},

		DeleteSsrcs_Promise: function (ssrcsToRemove) {
			var that = this;

			var toRemove = this.removeSsrcsFromSdpObj(this._savRemoteSdpObj, ssrcsToRemove);
			if (toRemove) {
				V.log('DeleteSsrcs_Promise:', ssrcsToRemove,'log');
				return that.setSDPs(that._savRemoteSdpObj, that._transportData.tr, "offer");

				/***
				var prm = new Promise(function(resolve, reject) {
					that.setSDPs(that._savRemoteSdpObj, that._transportData.tr, "offer").then(
							function (isOk) {
								if (isOk)
									resolve(isOk);
								else
									reject("DeleteSsrcs_Promise error");
							}
						);
				});
				console.log("DBG 6105 DeleteSsrcs_Promise(): REAL promise");
				return prm;
				 ***/
			}

			console.log("DBG 6105 DeleteSsrcs_Promise(): empty promise, ssrcsToRemove[] :", ssrcsToRemove);
			return new Promise(function(resolve, reject) {resolve();});
		},
		
		
		// abag : id in the format "xxx-jid-yyy"
		getJidFromId: function (id) {
			var matches = id.match(/^\w+-(.*)-\w+$/);
			if (!matches || matches.length < 2 || !matches[1]) {
				V.log("getJidFromId error, invalid id : [" + matches + "]");
				return null;
			} else {
				return matches[1];
			}
		},

		getJidBySsrc: function (ssrc) {
			return this._ssrcJidMap[ssrc];
		},

		// mtype == {"audio", "video"}
//		getSsrcByJid: function (jid, mtype) {
//			var ob = this._savedSsrcs[jid];
//			if (ob[mtype]) {
//				return ob[mtype].ssrc;
//			}
//			return null;
//		},

		// abag : id in the format "xxx-zzz-ssrc"
		getSsrcFromStreamId: function (id) {
			// Get the last word after '-'
			var parts = id.split('-');
			if (parts.length < 2) {
				V.log("getSsrcFromStreamId error, invalid id : [" + id + "]",'log');
				return null;
			} else {
				return parts[parts.length - 1];
			}
		},

		getClassType : function() {
			return "mustbeoverriden";
		},

		getMediaStreamId: function (msidextid1, msidextid2) {
			// !!! Put audio and video in the same media track !
			if (this.getClassType() == "sharingstream") {
				msidextid2 = this.getClassType();
			} else {
				msidextid2 = 'XXXX';
			}

			return "MSID-" + msidextid1 + '-' + msidextid2;
		},

		getMSAudioTrackId: function (msidextid, extid) {
			return "MSTIDAUDIO-" + msidextid + "-" + extid;
		},

		getMSVideoTrackId: function (msidextid, extid) {
			return "MSTIDVIDEO-" + msidextid + "-" + extid;
		},

		getMSScreenTrackId: function (msidextid, extid) {
			return "MSTIDSCREEN-" + msidextid + "-" + extid;
		},

		// abag
		CreateSublineMsid: function (streamType, msidextid, extid) {
			var line_msid = this.getMediaStreamId(msidextid, extid) + " ";

			switch (streamType) {
				case "audio":
					line_msid += this.getMSAudioTrackId(msidextid, extid);
					break;
				case "video":
					line_msid += this.getMSVideoTrackId(msidextid, extid);
					break;
				case "screen":
					line_msid += this.getMSScreenTrackId(msidextid, extid);
					break;
			}
			return line_msid;
		},

		// abag
		CreateLineMsid: function (ssrc, msidextid, streamType) {
			var line = "a=ssrc:" + ssrc + " msid:" + this.CreateSublineMsid(streamType, msidextid, ssrc);
			line += "\r\n";
			return line;
		},

		// Set upper bitrate limit for outgoing stream
		SetMaxBweBitrate(maxBr, force) {
			V.log('BWE SetMaxBweBitrate:' + maxBr, 'Debug');
			this._maxBweBitrate = maxBr;
			if (force) {
				var senders = this._peerConnection.getSenders();
				for (var i = 0; i < senders.length; i++) {
					var snd = senders[i];
					if (snd.track.kind === 'video') {
						var sendParams = snd.getParameters();
						if (typeof sendParams.encodings !== "undefined") {
							var enc = sendParams.encodings[0];
							enc.maxBitrate = maxBr;
							try {
								snd.setParameters(sendParams);
							} catch (e) {
								V.log(e, 'error');
							}
						}

					}
				}
			}
		},

        CalcMaxBandWidthKb: function (minPartBwKb) {
            var maxPartBwKb = this._jmate._opt.bitrate_limit ? this._jmate._opt.bitrate_limit : 1300;
            return maxPartBwKb < minPartBwKb ? minPartBwKb : maxPartBwKb;
        },

		// abag
		SetSendingBandwidth: function (sdp_) {
			var startPartBwKb = 800; //550; //800; // 380
			var minPartBwKb = 30; // 380
			var bwMaxPartKb = this.CalcMaxBandWidthKb(minPartBwKb); // 500
			if (bwMaxPartKb > this._maxBweBitrate) {
				bwMaxPartKb = this._maxBweBitrate;
			}

			var bwMaxVideoPerPartKb = bwMaxPartKb;
			var bwMaxAudioPerPartKb = null; // 64 //bwMaxVideoPerPartKb / 10;

			V.log("SetSendingBandwidth() : bwMaxVideoPerPartKb = " + bwMaxVideoPerPartKb +
				", bwMaxAudioPerPartKb = " + bwMaxAudioPerPartKb, 'log');

			//if (V.interopSDPClass.isChrome()) {
			if (!V.interopSDPClass.isFirefox()) {
				sdp_ = vmSDP.SetSendingVideoBitrate(sdp_, startPartBwKb, minPartBwKb, bwMaxVideoPerPartKb, ["VP8", "H264"]);
				//sdp_ = vmSDP.SetSendingBandwidthTIAS(sdp_, bwMaxAudioPerPartKb, bwMaxVideoPerPartKb);
				sdp_ = vmSDP.SetSendingBandwidthAS(sdp_, bwMaxAudioPerPartKb, bwMaxVideoPerPartKb);
			} else {
				//sdp_ = vmSDP.SetSendingBandwidthAS(sdp_, bwMaxAudioPerPartKb, bwMaxVideoPerPartKb);
				sdp_ = vmSDP.SetSendingBandwidthTIAS(sdp_, bwMaxAudioPerPartKb, bwMaxVideoPerPartKb);
			}
			return sdp_;
		},

		getConstraints : function(um, desktopStream){
			var constraints = {audio: false, video: false};
			if (um.indexOf('video') >= 0) {
				var res = this._jmate.getOpt('video_resolution') ? this._jmate.getOpt('video_resolution') : this.video_resolution;

				//var supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
				//var frSupported = supportedConstraints.hasOwnProperty('frameRate');

				var vc = V.VideoConstraints;

				constraints.video = {
					deviceId: this._gum_opt.videoSource ? {exact: this._gum_opt.videoSource} : undefined,
					width : {}, // {max: 1920, ideal: res.w},
					height: {}, // {max: 1080, ideal: res.h},
					frameRate: {} // {min: 10, max: 30, ideal:15}
				};
				if (vc.width_min) {
					constraints.video.width.min = vc.width_min;
				}
				if (vc.width_max) {
					constraints.video.width.max = vc.width_max;
				}
				// if (vc.width_ideal) {
				// 	constraints.video.width.ideal = vc.width_ideal;
				// } else {
				// 	constraints.video.width.ideal = res.w;
				// }
				if (res.w) {
					constraints.video.width.ideal = res.w;
				} else {
					constraints.video.width.ideal = vc.width_ideal;
				}

				if (vc.height_min) {
					constraints.video.height.min = vc.height_min;
				}
				if (vc.height_max) {
					constraints.video.height.max = vc.height_max;
				}
				// if (vc.height_ideal) {
				// 	constraints.video.height.ideal = vc.height_ideal;
				// } else {
				// 	constraints.video.height.ideal = res.h;
				// }
				if (res.h) {
					constraints.video.height.ideal = res.h;
				} else {
					constraints.video.height.ideal = vc.height_ideal;
				}
				if (vc.frameRate_min) {
					constraints.video.frameRate.min = vc.frameRate_min;
				}
				if (vc.frameRate_max) {
					constraints.video.frameRate.max = vc.frameRate_max;
				}
				if (vc.frameRate_ideal) {
					constraints.video.frameRate.ideal = vc.frameRate_ideal;
				}

				// Firefox (75) fails with frameRate.max other than 30
				if (V.interopSDPClass.isFirefox()) {
					delete constraints.video.frameRate.max;
				}
				
				if(V.interopSDPClass.isSafari()) {
					//safari does not eat frameRate max, somewhy
					//delete constraints.video.frameRate;
					delete constraints.video.frameRate.max;
					// safari do not like non-standard aspects
					if (res.w) {
						delete constraints.video.height;
					}
				}
			}
			if (um.indexOf('audio') >= 0) {
				constraints.audio = {
						deviceId: this._gum_opt.audioSource ? {exact: this._gum_opt.audioSource} : undefined,
						// if it is good enough for hangouts... 
						//advanced for optional params
						advanced: [
								   	{googEchoCancellation: true},
								   	{googAutoGainControl: true},
								   	{googNoiseSuppression: true},
								   	{googHighpassFilter: true},
								   	{googNoiseSuppression2: true},
								   	{googEchoCancellation2: true},
								   	{googAutoGainControl2: true},
									{googTypingNoiseDetection: true},
									//{googAudioMirroring: true}
								   ]
								   
				};
			}
			if (um.indexOf('desktop') >= 0) {
				constraints.video = {
					mandatory: {
						chromeMediaSource: "desktop",
						chromeMediaSourceId: desktopStream,
						maxWidth: window.screen.width,
						maxHeight: window.screen.height,
						maxFrameRate: 3
					},
					optional: []
				};
			}
			return constraints;
		},

		setDevice : function(kind, devid){
			V.log('setDevice',kind, devid);
			if(kind == 'videoinput'){
				this._gum_opt.videoSource = devid;
				if(this._locVideoStream)
					this.rerequestStream('video');
			}else
			if(kind == 'audioinput'){
				this._gum_opt.audioSource = devid;
				if(this._locAudioStream)
					this.rerequestStream('audio');
			}else
			if(kind == 'audiooutput'){
				this._audioOutDeviceId = devid;
				$.each(this._audioPlayers, function(i, a){
					if (typeof a.sinkId !== 'undefined') {
						a.setSinkId(devid);
						// TODO: catch & report about errors and success
					}else{
						V.log('Browser does not support sinkId','warn');
					}
				});
			}
		},
		rerequestStream : function(type, okcb){
			var wrtc = this;
			wrtc.getUserMediaWithConstraints(
					[type],
					function (stream) {
						if(okcb)
							okcb(stream);
						wrtc.switchStream(stream);
					},
					function(errmsg){
						//TODO: clean this stream requesting
						var stream = wrtc.getDummyStream();
						if(okcb)
							okcb(stream);
						wrtc.switchStream(stream);
						
						V.log(errmsg,'error');
					});
		},


		// abag
		stopLocalStream : function () {
			this.PC_removeStream(this._locVideoStream, true);
		},

		restoreVideoStream: function() {
			if (this._locVideoStream) {
				this.switchStream(this._locVideoStream);
			} else {
				this.rerequestStream('video');
			}
		},

		// abag : for FF 57 mute
		switchStream : function(newStream, outOnly) {
			V.log("DBG207 SwitchStream() New", 'debug');
			var that = this;

			//--------------------
			// Exchange audio track to new audio one, video to the new video
			var ReplaceTrack = function(senders_, newStream_, newTracks_) {
				var wasReplaced = false;
				for (var j = 0; j < newTracks_.length; j++) {
					var newTrack = newTracks_[j];
					for (var i = 0; i < senders_.length; i++) {
						var sender = senders_[i];
						if (sender.track) {
							//if (sender.track.readyState !== "ended" && sender.track.kind == newTrack.kind) {
							if (sender.track.kind == newTrack.kind) {
								V.log("DBG2071 newTrack.readyState=", newTrack.readyState, 'debug');
								V.log("DBG2071 " + i + ". sender.track.kind==" + sender.track.kind + " track will be replaced with :  ", newTrack.id + " [" + newTrack.label + "]", "sender.track.readyState=", sender.track.readyState, 'debug');
								try {
									// returns Promise
									return sender.replaceTrack(newTrack);
								} catch (e) {
									V.log("DBG207 sender.replaceTrack error : ", e.message, 'error');
								}
								wasReplaced = true;
								break;
							}
						}
					}
					if (wasReplaced) {
						break;
					}
				}
				//return wasReplaced;
				return new Promise(function(resolve, reject) {
					V.log("DBG2071 No tracks replaced", 'debug');
					reject("No tracks replaced");
				});
			};
			//--------------------
			var AttachVideo = function(newStream_) {
				if(outOnly){
					//dont save to local stream
					return;
				}
				// set new stream as local
				that['_loc'+kind+'Stream'] = newStream_;
				if(kind == 'Video' && that._$localView)
					WRTCA.attachMediaStream(that._$localView, newStream_);
			};
			
			if(that.noOutMedia){
				//dont send new stream, only save and show
				AttachVideo(newStream);
				return;
			}
			var senders;
			// Check if exists method replaceTrack
			var replaceTrackExists = false;
			if (this._peerConnection.getSenders) {
				senders = that._peerConnection.getSenders();
				for (var i = 0; i < senders.length; i++) {
					replaceTrackExists = !!senders[i].replaceTrack;
					break;
				}
			}

			V.log("RTCRtpeerConnection.replaceTrack " + (replaceTrackExists ? "exists" : "NOT exist"), 'debug');

			var kind = newStream.getVideoTracks().length ? 'Video' : 'Audio';

			// Check if method replaceTrack not exist but removeStream exists (like Chrome)
			if (!replaceTrackExists && this._peerConnection.removeStream) {
				// remove old stream from pc
				this.PC_removeStream(this['_loc'+kind+'Stream'], true);
				// add new to pc
				if (!this._peerConnection.addStream) {
					console.warn("BAD this._peerConnection.addStream !!!");
				}
				this._peerConnection.addStream(newStream);
				AttachVideo(newStream);
				// set flag for onnegneeded
				this._streamSwitched = true;
			} else {
				// (like Firefox >= 57)
				V.log("DBG207 before replaceTrack() : senders.length == ", senders.length, that.TAG, 'debug');

				if (senders.length === 0) {
					// set flag for onnegneeded
					this._streamSwitched = true;
					this._peerConnection.addStream(newStream);
					AttachVideo(newStream);

/*					// The same as this._peerConnection.addStream(newStream) but with video tracks only
					for (var k = 0; k < newStream.getVideoTracks().length; k++) {
						var vtrack = newStream.getVideoTracks()[k];
						this._peerConnection.addTrack(vtrack, newStream);
					}
					AttachVideo(newStream);
 */

				} else {
					var rtPromise = ReplaceTrack(senders, newStream, kind == 'Video' ? newStream.getVideoTracks() : newStream.getAudioTracks());
					rtPromise.then(
							function (parm) {
								V.log("DBG2071 after replaceTrack() : senders.length == ", senders.length, that.TAG, 'debug');
								AttachVideo(newStream);
								that.TouchSDPs(); // 06.04.2018
								// set flag for onnegneeded
								that._streamSwitched = true;
							},
							function (error) {
								V.log("DBG2071 after replaceTrack() : ReplaceTrack FAILED: " + error, that.TAG, 'debug');
								that._peerConnection.addStream(newStream);
								AttachVideo(newStream);
								// set flag for onnegneeded
								that._streamSwitched = true;
							}
					);

				}
			}
		},

		getUserMediaWithConstraints : function(
				um, success_callback, failure_callback, desktopStream) {

			var that = this;
			var forSharing = (um[0] === "desktop");
			var constraints = this.getConstraints(um, desktopStream);
			V.log("Get media constraints", constraints);

			try {
				// for mediaDevices.getUserMedia used new adapter.js
				navigator.mediaDevices.getUserMedia(constraints)
					.then(function (stream) {
						V.log('onUserMediaSuccess');
						success_callback(stream);
					})
					.catch(function (error) {
							V.log("Failed to get access to local media. Error " + error.toString() + " " + error.constraint, 'error');
							failure_callback && failure_callback(error);
						})
			} catch (e) {
				V.log("GUM failed: " + e, 'error');
				if(failure_callback) {
					failure_callback(e);
				}
			}
		},

		PC_removeStream : function (stream, stopStreams) {
			if (!stream) {
				return;
			}
			V.log('removeStream', stream.id);
			if(stopStreams) {
				stream.getAudioTracks().forEach(function (track) {
					// stop() not supported with IE
					if (track.stop) {
						track.stop();
					}
				});
				stream.getVideoTracks().forEach(function (track) {
					// stop() not supported with IE
					if (track.stop) {
						track.stop();
					}
				});
				if (stream.stop) {
					stream.stop();
				}
			}

			try {
				// FF doesn't support this no more (removeStream is deprecated).
				if (this._peerConnection.removeStream)
					this._peerConnection.removeStream(stream);
			} catch (e) {
				V.log(e,'error');
			}
		},

		obtainSharing : function (success,fail) {
			V.JMateClass.Sharing.obtainSharing(success,fail);
		},

		isSharingOn : false, // by default

		reloginWithStream : function (stream) {
			var that = this;
			that._jmate.trigger("WRTC.OnReloginStarted");
			// prepare loc stream
			that._locVideoStream = stream;
			
			// stop current call
			if(that._peerConnection.signalingState != 'closed')
				that._peerConnection.close();
			
			that._jmate._wm.SendTerminate(function(){
				// prepare layoutview
				that._jmate.UIVideView.reset();
				
				// start new call after old closed
				that.buildTransport();
			});
		},
		dummyCanvas : null,
		dummyImage : null,
		dummyTimer : null,
		makeDummy : function () {
			var that = this;
			var canvas = that.dummyCanvas = $('<canvas id="holdImage" width="480" height="360" class="hide_object" style="position:absolute;"></canvas>')[0];
			$(canvas).css({
				position: 'absolute',
				left: '-99999px',
				top: '-99999px'
			});
			$('body').append(canvas);
			if(typeof this._jmate.camDummy === 'string'){
				var im = that.dummyImage = new Image();
				im.src = this._jmate.camDummy;
			} else if(typeof this._jmate.camDummy === 'function'){
				this.drawDefaultDummy = this._jmate.camDummy;
			}
			
		},
		drawDefaultDummy : function (canvas) {
			var ctx = canvas.getContext('2d');
			ctx.fillStyle = "#fff";
			ctx.fillRect(canvas.width/2-60, canvas.height/2-60, 120, 150);
			ctx.fillStyle = "#aaa";
			ctx.beginPath();
			ctx.arc(canvas.width/2, canvas.height/2, 30, 0, Math.PI*2);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(canvas.width/2, canvas.height/2+90, 60, 0, Math.PI, true);
			ctx.fill();
		},
		drawDummy : function () {
			var that = this;
			var canvas = that.dummyCanvas;
			var ctx = canvas.getContext('2d');
			//background
			ctx.fillStyle = "#eee";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			//image
			var im = that.dummyImage;
			if(im){
				ctx.drawImage(im, canvas.width/2-im.width/2, canvas.height/2-im.height/2);
			}else{
				this.drawDefaultDummy(this.dummyCanvas);
			}

			
			//precaution for double call
			if(that.dummyTimer)
				clearTimeout(that.dummyTimer);
			that.dummyTimer = setTimeout(that.drawDummy.bind(that), 1000);
		},
		getDummyStream : function () {
			var that = this;
			if(!that.dummyCanvas)
				that.makeDummy();
			//run dummy drawer
			that.drawDummy();
			//switch stream
			return that.dummyCanvas.captureStream();
		},
		runDummy : function () {
			var that = this;
//			if(!that.dummyCanvas)
//				that.makeDummy();
//			//run dummy drawer
//			that.drawDummy();
//			//switch stream
//			var stream = that.dummyCanvas.captureStream();
			
			that.switchStream(that.getDummyStream());
		},
		stopDummy : function () {
			var that = this;
			clearTimeout(that.dummyTimer);
			that.rerequestStream('video');
		},
		showDummy : function (b) {
			var wrtc = this;
			var ls = wrtc._locVideoStream;
			if(!ls)
				return false;
			var tracks = ls.getVideoTracks();
			if(!tracks.length)
				return false;
			
			tracks[0].enabled = !b;
			
			if(b){
				wrtc.runDummy();
			}else{
				wrtc.stopDummy();
			}
			return true;
		},

		IsMixerUser: function(name_) {
			var ret = (name_ == "conf-amixer" || name_ == "conf-vmixer");
			return ret;
		},

		IsMixerSsrcObject: function(ssrcObj_) {
			return this.IsMixerUser(ssrcObj_.user);
		},

		FF_UnhideUser: function (jidToUnhide_) {
			if (!V.interopSDPClass.isFirefox()) {
				return;
				}

			this.fful.UnhideUser(jidToUnhide_);
		},

		// u_ : {id: party.Login, t: "video", s: ssrc, c: cname}
		FF_AddUserSsrc: function (u_) {
//			if (false) {
//				// Note : for audio we always need only audio mixer ssrc & cname, which are shipped using other ways.
//				// For video we need only video mixer ssrc & cname in mixing conference, and they are also shipped using other ways.
//			if (this._useVideoMixer) {
//				V.log("FF_AddUserSsrc() : for mixing conference canceled adding a user ssrc : ", u_, 'debug');
//				return;
//			} else {
//				if (u_.t === "audio") {
//					V.log("FF_AddUserSsrc() : for muxing conference canceled adding audio user ssrc : ", u_, 'debug');
//					return;
//				}
//			}
//			} else {
				// Возникли подозрения, что иногда MSE посылает аудио не через микшированные потоки.
				// Для проверки пока разрешим аудио потоки (если так, то обход бага с Unified Plan в хроме не получится)
				if (this._useVideoMixer && u_.t === "video") {
					V.log("FF_AddUserSsrc() : for mixing conference canceled adding a user ssrc : ", u_, 'debug');
					return;
				}
				if (u_.t === "audio") {
					V.log("FF_AddUserSsrc() : adding some non-mixing audio ssrc : ", u_, 'warn');
				}
//			}

			if (!V.interopSDPClass.isFirefox()) {
				this.addSsrc(u_);
			} else {
				this.fful.AddUpdateUser(u_);
			}
		},

        // u_ : {id: party.Login, t: "video", s: ssrc, c: cname}
        FF_DeleteUser: function (u_) {

			// Workaround _workaround_SAF_001 : onremovetrack handler is not called by Safari.
			if (this._workaround_SAF_001 && V.interopSDPClass.isSafari()) {
				// pure virtual method
				this.CallRemoveStream(u_.jid);
			}

			// Здесь надо удалять не список ssrc, а целого юзеря.
			if (!V.interopSDPClass.isFirefox()) {
				var ssrcs = [];
				if (u_.ssrc_a) {
					ssrcs.push(u_.ssrc_a)
					}
				if (u_.ssrc_v) {
					ssrcs.push(u_.ssrc_v)
				}
				this.DeleteSsrcs(ssrcs);
			} else {
				//this.fful.DeleteUser(u_);
				this.fful.DeleteOrReplaceUser(u_);
			}
		},

		TouchSDPs : function(onok) {
			var that = this;
			this.queue.addJobToQueue(function(end){
				that.setSDPs(that._savRemoteSdpObj, that._transportData.tr, "offer").then(
						function(isOk) {
							if (onok) {onok();}
							end();
						},
						function(err) { end(); }
				);
			});
		},

		// Note : degradationPreference not yet implemented in Chrome 69 & FF 62
		setDegradationPrefs : function() {
			var dpref = "maintain-resolution";

			if (typeof this._peerConnection.getSenders !== "undefined") {
				var senders = this._peerConnection.getSenders();
				for (var i = 0; i < senders.length; i++) {
					var sender = senders[i];
					if (typeof sender.setParameters !== "undefined") {
						if (sender.track.kind === "video") {
							var params = sender.getParameters();
							if (params.degradationPreference !== dpref) {
								params.degradationPreference = dpref;
								sender.setParameters(params).then(
									function(result) {
										V.log("video degradationPreferences set to : ", dpref, "for ", sender.track.label, "log");
									},
									function(err) {
										V.log("video degradationPreferences setting Failed : ", err, "error")
									}
								);
							}
						}
					}
				}
			}
		},

		setQoSPriorities : function() {
			var audioPty = "high";
			var videoPty = "medium";
			var otherPty = "medium";
			var that = this;
			var wasQoSSet = false;

			var showPriority = function(name_) {
				var senders = that._peerConnection.getSenders();
				for (var i = 0; i < senders.length; i++) {
					var sender = senders[i];
					if (!sender || !sender.track) {
						continue;
					}
					var sendParams;
					if (typeof sender.getParameters !== "undefined") {
						var changed = false;
						sendParams = sender.getParameters();
						if (typeof sendParams.encodings !== "undefined") {
							//V.log(, "log");
							V.log("DBG 451 " + name_ + ": sender.track: " + sender.track.kind + " " + sender.track.label, "log");
							for (var j = 0; j < sendParams.encodings.length; j++) {
								var enc = sendParams.encodings[j];
								V.log("DBG 4511  enc.priority : ", enc.priority, "log");
							}
						}
				}
			}
			};

			if (typeof this._peerConnection.getSenders !== "undefined") {
				showPriority("old priority");

				var senders = this._peerConnection.getSenders();
				for (var i = 0; i < senders.length; i++) {
					var sender = senders[i];
					if (!sender || !sender.track) {
						continue;
					}
					var sendParams;
					var changed = false;
					if (typeof sender.getParameters !== "undefined") {
						sendParams = sender.getParameters();
						if (typeof sendParams.encodings !== "undefined") {
							//console.log("DBG 451 sender.track: " + sender.track.kind + " " + sender.track.label);
							//console.log("DBG 451   sendParams.encodings : ", sendParams.encodings);
							for (var j = 0; j < sendParams.encodings.length; j++) {
								var enc = sendParams.encodings[j];
								if (typeof enc.priority !== "undefined") {
									//console.log("DBG 451   old enc.priority : ", enc.priority);
									if (sender.track.kind === "audio") {
										enc.priority = audioPty;
									} else if (sender.track.kind === "video") {
										enc.priority = videoPty;
									} else {
										enc.priority = otherPty;
									}
									changed = true;
								}
							}
						}
		}

					if (typeof sender.setParameters !== "undefined") {
						if (changed) {
							sender.setParameters(sendParams).then(
									function(result) {
										wasQoSSet = true;
										V.log("DBG 451   sender.setParameters OK", "log");
										showPriority("new priority");
									},
									function(err) {
										V.log("DBG 451   sender.setParameters Failed : ", err, "error")
									}
							);
					}
					}
				}
			}

			if (wasQoSSet) {
				V.log("QoS priority was set, audio : " + audioPty + ", video : " + videoPty + ", other : " + otherPty, "log");
			}
		},

		testDevices : function() {
			if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
				console.log("enumerateDevices() not supported.");
				return;
			}

			// List cameras and microphones.

			navigator.mediaDevices.enumerateDevices()
					.then(function(devices) {
						devices.forEach(function(device) {
							console.log("DEVICE: " + device.kind + ": " + device.label +
									" id = " + device.deviceId);
						});
					})
					.catch(function(err) {
						console.log(err.name + ": " + err.message);
					});
		},

		selectDevices : function() {
			this.testDevices();

			var that = this;
			var devices = {
				audioInput : null,
				audioOutput : null,
				videoInput : null
			};

			var prm = new Promise(function(resolve, reject) {
				navigator.mediaDevices.enumerateDevices()
						.then(function(devices) {
							devices.forEach(function(device) {
								if (device.kind === "audioinput") {
									// "MagicCamera"; "Microsoft", "TY-CC20W"
									var devName = "Microsoft";
										if (device.label.indexOf(devName) >= 0) {
										devices.audioInput = device;
//									that._jmate.setDevice(device.kind, device.deviceId);
									}
								} else if (device.kind === "videoinput") {
									// "MagicCamera"; "Microsoft", "TY-CC20W"
									var devName = "Microsoft";
									//var devName = "TY-CC20W";
									if (device.label.indexOf(devName) >= 0) {
										devices.videoInput = device;
//									that._jmate.setDevice(device.kind, device.deviceId);
									}
								}
								// else if (device.kind === "audiooutput" && device.label === "чего-") {
								// //this._jmate.setDevice(device.kind, device.id);
								// devices.audioOutput = device;
								// }
							});

							resolve(devices);
						})
						.catch(function(err) {
							V.log(err.name + ": " + err.message, "error");
							reject(err);
						});
			});
			prm.then(
					function(devices) {
						if (devices.audioInput) {
							that._jmate.setDevice(devices.audioInput.kind, devices.audioInput.deviceId);
						}
						if (devices.audioOutput) {
							that._jmate.setDevice(devices.audioOutput.kind, devices.audioOutput.deviceId);
						}
						if (devices.videoInput) {
							that._jmate.setDevice(devices.videoInput.kind, devices.videoInput.deviceId);
							}
					},
					function(err) {
						V.log("selectDevices ERROR ", err.name + ": " + err.message, "error");
						}
				);
		},

		// webrtc encryption could be disabled in Canary using -disable-webrtc-encryption command line flag
		isEncryptionDisabled : function(pc_) {
			return new Promise(function(resolve, reject) {
				// check global varuable
				if (typeof V.isEncryptionDisabled !== 'undefined' && V.isEncryptionDisabled !== null) {
					resolve(V.isEncryptionDisabled);
					return;
				}

				if (!V.interopSDPClass.isChrome()) {
					V.isEncryptionDisabled = false;
					resolve(V.isEncryptionDisabled);
					return;
				}

				var pc = null;
				if (pc_) {
					pc = pc_;
				} else {
					pc = new RTCPeerConnection();
				}
				var offerOpts = {
					'mandatory': {
						'OfferToReceiveAudio':true,
						'OfferToReceiveVideo':false,
					}};
				var ret = false;
				pc.createOffer(offerOpts).then(
						function (localSdp) {
							var arr = localSdp.sdp.split('\r\n');
							for (var i = 0; i < arr.length; i++) {
								var line = arr[i];
								if (line[0] == "m" && line[1] == "=") {
									V.isEncryptionDisabled = (line.indexOf("SAVPF") < 0);
									resolve(V.isEncryptionDisabled);
									delete pc;
									resolve(ret);
									break;
								}
							}
						},
						function(err) {
							reject(err)
						}
				);
			});
		},

		WaitForState: function (state_) {
			var that = this;
			return this.WaitFor( function() {
					return that._peerConnection.signalingState == state_;
				},
				20,
				100,
				"signalling state '" + state_ + "'"
			);
		},

		// Waiting for itHappenedCbk() == true
		//   itHappenedCbk - callback, must return true when the awaited event has been happened
		//   cycleDelay - delay between iterations
		//   maxCount - max iterations count; if 0/null then no limit
		//   descr - description for the logging
		//  Max total delay is (cycleDelay * maxCount) if maxCount is defined
		WaitFor: function (itHappenedCbk, cycleDelay, maxCount, descr) {
			var that = this;
			return new Promise(function (resolve, reject) {
				if (itHappenedCbk()) {
					V.log(that.TAG + " WaitFor " + (descr ? descr:"") + " OK (not delayed)");
                    resolve();
                } else {
                    var cnt = 0;
                    var intervalId = setInterval(
                        function () {
							V.log(that.TAG + " WaitFor " + (descr ? descr:"") + ", cnt = " + cnt);
							if (itHappenedCbk()) {
                                clearInterval(intervalId);
								V.log(that.TAG + " WaitFor " + (descr ? descr:"") + " OK (delayed)");
                                resolve();
							} else if (maxCount && (cnt++ > maxCount)) {
                                clearInterval(intervalId);
								V.log(that.TAG + " WaitFor " + (descr ? descr:"") + " FAILED");
								reject(that.TAG + " WaitFor " + (descr ? descr:"") + " FAILED");
                            }
                        },
						cycleDelay);
                     }
			});
		},
		
		// Mute audio/video output channel via sender.replaceTrack()
		systemMuteTrack: function(mtype, yesno) {
			var that = this;

//			var ReplaceOutputVideoTrack = function(newTrack) {
//				var senders = that._peerConnection.getSenders();
//				for (var i = 0; i < senders.length; i++) {
//					var sender = senders[i];
//					if (sender.track) {
//						if (sender.track.kind === 'video') {
//							return sender.replaceTrack(newTrack);
//						}
//					}
//				}
//			};

			if (mtype === 'video') {
				if (this._locVideoStream) {
					if (yesno) {
						that.switchStream(that.getDummyStream(),true);
						that.noOutMedia = true;
					} else {
						that.noOutMedia = false;
						that.switchStream(that._locVideoStream);
					}

				}
			}
			else if (mtype === 'audio') {
				if (this._locAudioStream) {
					var track = this._locAudioStream.getAudioTracks()[0];
					//track.muted = !yesno;
					track.enabled = !yesno;
					V.log(this.TAG + " systemMuteTrack (" + mtype + ") : " + yesno, 'debug');
				}
			}
		},

		// newframerate - in fps
		// use newbitrate == 'unlimited' to cancel limitation
		// use null to skip the parameter
		SetSendingFramerate: function(mtype, pc, newframerate) {
			this.SetSendingBitFrameRate(mtype, pc, null, newframerate);
		},

		// newbitrate in kbps
		// use newbitrate == 'unlimited' to cancel limitation
		//  maxFramerate
		SetSendingBitrate: function(mtype, pc, newbitrate, newframerate) {
			this.SetSendingBitFrameRate(mtype, pc, newbitrate, null);
		},

		// newbitrate - in kbps
		// newframerate - in fps
		// use newbitrate == 'unlimited' to cancel limitation
		// use null to skip the parameter
		//
		// Note : newframerate works for Chrome >= 82
		SetSendingBitFrameRate: function(mtype, pc, newbitrate, newframerate){
			if (!pc) {
				V.log(this.TAG + " SetSendingBitFrameRate() error : pc undefined", 'warn');
				return;
			}
			// In Chrome, use RTCRtpSender.setParameters to change bandwidth without
			// (local) renegotiation. Note that this will be within the envelope of
			// the initial maximum bandwidth negotiated via SDP.
			if ((V.interopSDPClass.isChrome() ||
				(V.interopSDPClass.isFirefox()
					//	&&	adapter.browserDetails.version >= 64
				)) &&
				'RTCRtpSender' in window &&
				'setParameters' in window.RTCRtpSender.prototype) {
				var ndx = mtype === 'audio' ? 0 : 1;
				const sender = pc.getSenders()[ndx];
				if (!sender) {
					V.log(this.TAG + " SetSendingBitFrameRate() error : sender undefined", 'warn');
					return;
				}

				const parameters = sender.getParameters();
				if (!parameters.encodings) {
					parameters.encodings = [{}];
				}
				if (newbitrate) {
					if (newbitrate === 'unlimited') {
						delete parameters.encodings[0].maxBitrate;
					} else {
						parameters.encodings[0].maxBitrate = newbitrate * 1000;
					}
				}
				if (newframerate) {
					if (newframerate === 'unlimited') {
						delete parameters.encodings[0].maxFramerate;
					} else {
						parameters.encodings[0].maxFramerate = newframerate;
					}
				}

				sender.setParameters(parameters)
					.then(() => {
						V.log(this.TAG + "SetSendingBitFrameRate() OK: newbitrate: " + newbitrate + ", newframerate: " + newframerate, 'debug');
						//bandwidthSelector.disabled = false;
					})
					.catch(function(err) {
						V.log(pc.debugTag + "SetSendingBitFrameRate() failed" + err, 'error');
					});
				return;
			}
		}

//--- \constraints
	});
})();
/**
 * Fired when stream added
 * @event OnAddStream
 * @param {Event} event Event object
 * @param {Stream} stream Media Stream object
 */
/**
 * Fired when stream removed
 * @event OnRemoveStream
 * @param {Event} event Event object
 * @param {Stream} stream Media Stream object
 */
/**
 * Fired when Track added
 * @event OnAddTrack
 * @param {Event} event Event object
 * @param {object} event
 */
/**
 * Fired when Connection Lost
 * @event OnConnectionLost
 * @param {Event} event Event object
 */