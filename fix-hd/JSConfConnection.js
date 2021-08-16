(function(){
	var V = VideoMost;
	/**
	 * @module Client
	 */
	/**
	 * JS based Conference Connection
	 * @class JSConfConnectionClass
	 * @extends ConfConnectionClass
	 */
	V.JSConfConnectionClass = V.ConfConnectionClass.New({
//		_client: null,
//		_username: null,
//		_confid: null,
//		_confdomain: null,
		_jmate: null,
		_options:null,
		/**
		 * @memberOf jsP2PConnection
		 */
		init: function(client){
			var that = this;
			this.__super('init',arguments);
			//defaults
			this._options = {
					video_maxparticipants:16,
					reordering:false,
					camDummy:null,
					bitrate_limit:9000,
					disableH264:false,
					audioonly:false,
					vmVersion:"6.2.0.1",
					use_screensharing:true,
					full_stats:false,
					localVideoInRemotes:false,
					fillVideoContainer:true,
					video_resolution: {}
			};
			
			this._client._XMan.on('OnMessage',function(e, msg ){
				var fromjid = msg.type=='groupchat' ? msg.name+'@'+that._confdomain : msg.jid;
				that.trigger('OnMessage', {
					from: that.Users.getUser(fromjid),
					fromjid: fromjid,
					body: msg.body,
					timestamp: msg.timestamp,
					isprivate: msg.type!='groupchat',
					nick: msg.nick
				});
			});
			
			this.Users = VideoMost.VMUsersClass.New().init(); //WMUsersO
			
			that._jmate = V.JMateClass.New().init({
				video_maxparticipants: 16,
				xman: this._client._XMan,
				users: this.Users,
				disableH264: false
			}, that);
			that._jmate.on('OnPartiesListReady',function(e,parties){
				that.Users.listInit({Parties:parties});
			});
			that._jmate.on('OnPartyLeave',function(e,party){
				that.Users.del(party);
			});
			that._jmate.on('OnPartyJoin',function(e,party){
				that.Users.add(party);
			});
			that._jmate.on('OnPartyAttributesChanged',function(e,Values){
				that.Users.setPartyAtributes(Values);
			});
			that._jmate.on('OnCallFailed',function(e, reason){
//				var r = 'unknown';
//				if(['timeout','offline'].indexOf(reason) != -1)
//					r = 'offline';
				that.trigger('OnCallFailed',reason);
			});
			that._jmate.on('OnTerminate',function(e, reason){
				V.log('OnTerminate', that.Users.getUserIm() && that.Users.getUserIm().Login, reason,'warn');
				that.trigger('OnTerminate', reason);
			});
			that._jmate.on('OnConferenceJoin',function(e){
				V.log('OnConferenceJoin', 'info');
				that.trigger('OnConferenceJoin');
			});
			that._jmate.on('OnUserViewClick',function(e, user){
				that.trigger('OnUserViewClick', user);
			});
			that._jmate.on('_onUserViewAdded',function(e, user, $container){
				that.trigger('OnUserViewAdded', user, $container);
			});
			that._jmate.on('_onStatsUpdate',function(e, stat){
				that.trigger('OnStatsUpdate', stat);
			});
			// Spectrum for
			that._jmate.on('_onGetSpectrumCanvas',function(e, jid, partSpectrum){
				that.trigger('OnGetSpectrumCanvas', jid, partSpectrum);
			});
			// Spectrum for
			that._jmate.on('_onGetVideoObject',function(e, jid, videoObKeeper){
				that.trigger('OnGetVideoObject', jid, videoObKeeper);
			});

			client.on('_OnDeviceSet', function(e, kind, id){
				that._jmate.setDevice(kind, id);
			});
			return this;
		},
		_localView: null,
		_remoteView: null,
		setView: function(views){
			var that = this;
			if(views.local){
				//TODO:make request local stream here
				this._localView = views.local;
				that._jmate.setView({local:views.local});
			}
			if(views.remote){
				var $rc = $(views.remote);
				$rc.empty();
//				var $remote = $rc;
				var $remote = $('<div class="remoteViewWrapper"/>').css('width','100%').css('height','100%');
				$rc.append($remote);
				
				this._remoteView = $remote[0];
				that._jmate.setView({remote:this._remoteView});
			}
		},
		JoinConference: function(opt){
			var that = this;
//			this.Users = WMUsersO = VideoMost.VMUsersClass.New().init({
//				myLogin: this._client._XMan.myBareJid(),
//			});
			this.SetOptions(this._options);

			// abag
			if (!this._options.use_screensharing) {
				if (that._jmate._wm._wrtc_sh) {
					that._jmate._wm._wrtc_sh = null;
				}
				if (that._jmate._wm._wrtc._wrtc_sh) {
					that._jmate._wm._wrtc._wrtc_sh = null;
				}
			}
			
			this.Users.setLogin(this._client._XMan.myBareJid());
			
			that._username = this._client._connOpts.username;
			
			that._jmate.setIceServers(this._client._connOpts.iceServers);
			var conf = opt.roomJid.split('@');
			that._confid = conf[0];
			that._confdomain = conf[1];
			
			that._jmate.CallConference(opt.roomJid, that._username);
		},
		/**
		 * Set conference options
		 * @method SetOptions
		 * @param {object} opt conference options
		 * 	@param {object} [opt.video_maxparticipants=16] maximum visible participants
		 * 	@param {object} [opt.reordering=false] reorder participant view by click 
		 * 	@param {object} [opt.camDummy=null] dummy image sending when camera is not available. Accept path to image file or data URL 
		 * 	@param {object} [opt.bitrate_limit=9000] max bitrate for client outgoing video 
		 * @return undefined
		 */
		SetOptions: function(opt){
			var that = this;
			var doOption = function(name, val){
				switch(name) {
				case 'video_maxparticipants':
					that._jmate.UIVideView.setMaxUsersShown(val);
					break;
				case 'reordering':
					that._jmate._reorderOnClick = !!val;
					break;
				case 'camDummy':
					that._jmate.camDummy = val;
					break;
				case 'bitrate_limit':
//					that._jmate._opt.bitrate_limit = val;
					that._jmate.setBitrateLimit(val);
					break;
				case 'disableH264':
					that._jmate.disableH264 = val;
					break;
				case 'audioonly':
					that._jmate._opt.audioonly = val;
					break;
				case 'vmVersion':
					that._jmate._opt.vmVersion = val;
					break;
				case 'use_screensharing':
					that._jmate._opt.use_screensharing = val;
					break;
				case 'full_stats':
					that._jmate._opt.use_full_stats = val;
					break;
//				case 'localVideoInRemotes':
				case 'fillVideoContainer':
					that._jmate.UIVideView.fillVideos(val);
					break;
				case 'video_resolution':
					that._jmate._opt['video_resolution'] = val;
				}
			}
			for(var o in opt){
				if(that._options[o] !== undefined ){
					that._options[o] = opt[o];
					doOption(o, opt[o]);
				}else{
					//unknown opt
					V.log('Got unknown option: ' + o, 'warn');
				}
				
			}
		},
		/**
		 * Get conference option
		 * @method GetOption
		 * @param {String} opt option name
		 * @return value option
		 */
		GetOption: function(opt){
			return this._options[opt]
		},
		ExitConference: function(){
			this._jmate.Terminate();
		},
		MuteMicrophone: function(b){
			this._jmate.MuteMicrophone(b);
		},
		DisableCamera: function(b){
			this._jmate.MuteCamera(b);
		},
		MuteSpeaker: function(b){
			this._jmate.MuteSpeaker(b);
		},
		SendMessage: function(message, to){
			this._client._XMan.SendMessage(to ? to.Login : this._confid + '@conference.'+this._confdomain, message, to ? 'normal' : 'groupchat' , this._username);
		},
		/**
		 * Redraw remote video layout. Should be called on remote video element resize.
		 * @method redrawRemoteView
		 * @return undefined 
		 */
		redrawRemoteView: function(){
			this._client._XMan.SendMessage(to ? to.Login : this._confid + '@conference.'+this._confdomain, message, to ? 'normal' : 'groupchat' , this._username);
		},
		stopVideoCapture: function(){
			this._jmate.stopVideoCapture();
		},
		stopAudioCapture: function(){
			this._jmate.stopAudioCapture();
		},
	});
})();