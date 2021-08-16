VMTransUtils.isWrtc = true;
jq17(document).ready(function($) {
	var V = VideoMost;
	loadingState('init');
    
    /////
    $('.send_msg').click(VMUserChat.sendChat);
	// $('#chat_msg').bind('keydown', "Ctrl+return", VMUserChat.sendChat);
	
	var shift = false;
 
	$('#chat_msg').keydown(function(event){
		switch (event.which) {
			case 13: return false;
			case 16: shift = true;
		}
	});
	$('#chat_msg').keyup(function(event){
		switch (event.which) {
			case 13:
			if (!shift) {
				VMUserChat.sendChat();
				return false;
			}
			var caret = event.target.selectionStart;
			event.target.setRangeText("\n", caret, caret, "end");
			this.text = event.target.value;

			break;
			case 16: shift = false;
		}          
	});
	
    //
    XMan.selectService(["wss://"+gVMSets.xmpp_server+":"+gVMSets.xmpp_websocket_port+"/ws/",'http-bind/'], function(s){
		// get ice server lists from admin settings
		var jsn = JSON.parse(gVMSets.adm_wrtc_stun_servers);
		var ice = jsn ? (jsn.stun ? [{ urls: jsn.stun}] : jsn) : undefined;
    	
    	var client = V.vmClient = V.getClient();
    	client.init({
    		username: user.name, //XXX: global user.name here
    		service: s,
    		iceServers: ice
    	});
    	window.XMan = client._XMan; //pull xman from client //TODO fixit
    	
    	var confConn = V.confConn = client.makeConfConnection();
//    	confConn.Users = confConn._jmate._VMUsers = WMUsersO; //XXX: injection of WMUsersO
    	window.JMate = confConn._jmate;
    	//TODO: move resolution to set option?
    	var res = confopts.video_out["video.size"].match(/{(\d+);(\d+)}/)
    	JMate._opt['video_resolution'] = {w:~~res[1], h: ~~res[2]}; 
    	JMateInit();
    	JMate.setSharingView($('#ss-view'));
    	
    	
    	window.WMUsersO = confConn.Users;
    	window.ConfUI = VideoMost.ConfUIZClass.New().init(confConn);
		$(document).trigger('ConfConnReady',[WMUsersO, confConn]);
    	
    	//init sharing
    	Sharing.init();
		VMUserChat.init();
		   	
    	client.Login(user.login+'@', user.login, 'spirit');//XXX: global user.login
    	client.on('OnConnected', function(){
    		VMC.startJconfSession(function(){
    			confConn.setView({
    				local: ConfUI.localViewEl,
    				remote:$('#remoteVideos')[0]
    			});
				// abag : uncomment to turn off sharing channel
                ///confConn.SetOptions({use_screensharing:false});
    			confConn.JoinConference({
    		    	roomJid: confopts.a.confroom_id.toLowerCase()+confopts.suffix+'@'+confopts.domain
    			});

				var res = confopts.video_out["video.size"].match(/{(\d+);(\d+)}/);

				var b = confopts.video_out["video.encoder.bitrate"];

				debugger;
    			confConn.SetOptions({
    				video_maxparticipants: vmLOM.getMaxVisible(),// gVMSets.option_def_video_maxparticipants
    				bitrate_limit: confopts.video_out["video.encoder.bitrate"],
    				disableH264: !gVMSets.adm_wrtc_h264_default_enabled,
    				camDummy: function(canvas){
    					var ctx = canvas.getContext('2d');
    					ctx.fillStyle = "#262626";
						ctx.fillRect(0, 0, canvas.width, canvas.height);
						ctx.font = "20px Arial";
						ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
						var userName = user.name;
						var text = ctx.measureText(userName);
						if(text.width > canvas.width) {
							ctx.textAlign = "left";
							ctx.fillText(userName, 0, canvas.height/2);
						} else {
							ctx.fillText(userName, canvas.width/2 - text.width/2, canvas.height/2);
						}
    				},
    				reordering: false,
    				audioonly: confopts.a.audio_conference_mode == 1,
    				vmVersion: confopts.vmVersion,
    				fillVideoContainer: UserPrefs.get('fillVideoContainer'),
    				localVideoInRemotes: !ConfUI.localViewEl,
					video_resolution: {w:~~res[1], h: ~~res[2]}
    			});
			});
			
			
		});
    	confConn.on('OnCallFailed', function(e, reason){
    		V.log('OnCallFailed', reason);
    		switch (reason) {
			case 'timeout':
				loadingState('err', _('the connection timed out'));
				break;
			case 'offline':
				loadingState('err', _('Error')+':'+_('unable server connection'));
				break;
			default:
				loadingState('err', _('unknown error'));
				break;
			}
    	});
    	confConn.on('OnUserViewClick', function(e, user){
    		ConfUI.onUserViewClick(user);
		});
		
    	var tuneState = function(user, state, $stateel, $container) {

			var sv = user.gs(state);

			var $userContainer = $container || $('#remoteVideos').find('[data-jid="'+user.Login + '"]');
			var $nickEl = $userContainer.find('.nick');
			
			if(state === 'cam') {
				if(sv === false){
					$nickEl.hide()
				}else{
					// if mic_state disabled - show nickname with <left: 0>
					$micEl = $userContainer.find('.mic_state');
					if($micEl.hasClass('disabled_state')){
						$nickEl.addClass('nick__left_0');
					} else {
						$nickEl.removeClass('nick__left_0');
					}
					$nickEl.show();
				}
			}

    		var $state = $stateel || $('#remoteVideos').find('[data-jid="'+user.Login+'"] .user_states > .'+state+'_state');
    		if(sv === null){
    			//if there no state known - hide states
    			$state.addClass('disabled_state');
    			return;
    		}else{
    			//show state el
    			if($state.hasClass('disabled_state')){
    				$state.removeClass('disabled_state');
    			}
    		}
    		if(sv){
    			$state.addClass(state+'_state_on');
    		}else{
    			$state.removeClass(state+'_state_on');
    		}
    	}
    	confConn.on('OnUserViewAdded', function(e, user, $container){
			var $states = $('<div class="user_states" />');
			var $mic = $('<div class="user_state mic_state mic_state_on" />');
			$states.append($mic);
			var $cam = $('<div class="user_state cam_state cam_state_on" />');
			$states.append($cam);
			$container.append($states);

			$nick = $('<p class="view_dummy__nick"/>').text(user.Name);
			$('.view_dummy', $container).append($nick);
				
			tuneState(user, 'mic', $mic);
			tuneState(user, 'cam', $cam, $container);
    	})
		confConn.Users.on('OnStateChanged', function(e, user, state, val) {
    		tuneState(user, state);
    		JMate.UIVideView.rebuildLayout(); //remove it?
    	});

    	//
    	WB.onSVGChange = function(){
    		VMUserChat.sendChatMsg(String.fromCharCode(0xa4)+String.fromCharCode(0xa6));
    	};
    	//------------
    	FitMainView();
    	$(window).bind('resize', function() {
    		FitMainView();
    	});
    	$(document).bind('keydown', "Ctrl+f3", function(e) {
    		if(gSets.get('Debug')){
    			VideoMost.log('Debug switched off','warn');
    			gSets.set('Debug',0,true);
    		}else{
    			gSets.set('Debug',1,true);
    			VideoMost.log('Debug switched on','warn');
    		}
    	});
    	
//    	VMFullscreen.init();
    	confirmDlgConf.init();
    	
    	$("#bl_keypad").accordion('option','active', false);
	},function(){
		V.log('Can\'t connect to XMPP','warn');
		loadingState('err', _('Could not connect to XMPP server'));
	});
    
});

function setMuteSpeakers(m){
	return JMate.Mute('Speaker',m);
}
function setMuteMicro(m){
	return JMate.Mute('Microphone',m);
}
function setMuteCamera(m){
	return JMate.Mute('Camera',m);
}
function loadingState(state, msg){
	VideoMost.log(msg,'warn');
	var m = msg || _('Error');
	messageDlg.initIfNot();
	
	var pm = new PreloadMessage();
	switch(state){
	case 'init':
		pm.showPreloadMessage(_('loading'));
		// messageDlg.showLoadingInfo(_('loading'));
		break;
	case 'needpermission':
		pm.showPreloadMessage(_('Please allow media'));
		// messageDlg.showLoadingInfo(_('Please allow media'));
		break;
	case 'started':
		pm.closePreloadMessage();
		//keep "banned" message
		if(WMUsersO.getUserIm().ga('banned') == 0){
			messageDlg.close();
		}
		break;
	case 'err':
		messageDlg.showFailInfo(m);
		break;
	}
}
//phono sdp doesn`t tolerate prototype insertion
delete Array.prototype.remove;
var JMateInit = function(){
	var V = VideoMost;
JMate.on('OnData',function(e,from,Name,Value){
	if(from == confopts.a.confroom_id.toLowerCase()+confopts.suffix+'@'+confopts.domain){
		//its message from jconf
		$(document).trigger('OnConfDataEvent',[Name, Value]);
		return;
	}
	$(document).trigger('OnDataEvent',[WMUsersO.getUser(from), Name, Value]);
	switch(Name){
		case 'retopt':
//			var reto = $.secureEvalJSON(Value);
//			rcDlg.setRValues(reto);
			break;
		case 'getopt':
//			if(! WMUsersO.getUser(Peer).ga('moderator'))
//				return;
//			var geto = $.secureEvalJSON(Value);
//			var reto = rcUtil.getOptions(geto);
//			sendData(Peer, 'retopt',$.toJSON(reto) );
			break;
		case 'setopt':
//			if(! WMUsersO.getUser(Peer).ga('moderator'))
//				return;
//			var seto = $.secureEvalJSON(Value);
//			rcUtil.setOptions(seto);
			break;
		case 'hangup':
			if(Value=='1') {
				ConfUI.exitConference(true);
//				window.location.href = service_url+'wjoin';
			}
			break;
		case 'micro_level_get':
			break;
		case 'micro_level_party':
			break;
		case 'micro_level':
			break;
		case 'irunsharing':
//			var u = WMUsersO.getUser(from);
//			VideoMost.log('user with sharing: '+u.Name,'info');
//			VideoSharing.setSharingUser(!!(+Value) ? u : null);
			break;
		default:
		}
});
JMate.on('OnChangeActiveUser',function(e, user){

	JMate.UIVideView.activeUser = user.j;
	if(JMate.UIVideView.isActiveSpeakerMode === true) {
		var currentUser = JMate._VMUsers.getUser(user.j);
		JMate._VMUsers.setMaxPriorityToUser(currentUser);
		if (JMate._spectrum) {
			JMate._spectrum.ChangeActiveUser(user.j);
		}
		
		if(JMate.UIVideView.isOneSpeakerMode === true) {
			vmLOM.enMode('fixto', currentUser);
		}
	} else {
		$(".videocontainer__active-state").removeClass("videocontainer__active-state");
		$state = $('#remoteVideos').find('[data-jid="' + user.j+ '"]');
		$state.addClass('videocontainer__active-state');
	}
});
JMate.on('OnPartiesListReady',function(e,parties){
//	WMUsersO.listInit({Parties:parties});

	loadingState('started');
	vmLOM.initDefault();
});
//JMate.on('OnPartyLeave',function(e,party){
//	WMUsersO.del(party);
//});
//JMate.on('OnPartyJoin',function(e,party){
//	WMUsersO.add(party);
//});
//JMate.on('OnPartyAttributesChanged',function(e,Values){
//	WMUsersO.setPartyAtributes(Values);
	// abag
//	if (Values.length > 0 && Values[0] && Values[0].attribs) {
//		// Needed for webinar mode
//		if (Values[0].attribs.speaker !== undefined || Values[0].attribs.visible !== undefined) {
//			this.redrawRemoteView();
//		}
//		// abag : mute camera for selector conf if a moderator switched off participant's video
//		if (JMate._VMUsers.getUser(Values[0].party).Im) {
//			var needTouchA = false;
//			var needTouchV = false;
//			var visible = true;
//			var audible = true;
//			if (Values[0].attribs.visible !== undefined) {
//				needTouchV = true;
//				visible = visible && Values[0].attribs.visible;
//			}
//			if (Values[0].attribs.speaker !== undefined) {
//				needTouchA = true;
//				audible = audible && Values[0].attribs.speaker;
//			}
//			if (needTouchV) {
//				//setMuteCamera(!visible);
//				JMate.SystemMute('video', !visible);
//				//JMate.Mute('Camera', !visible, true);
//			}
//			if (needTouchA) {
//				//JMate.SystemMute('audio', !audible);
//				// also checks if this user muted the microphone himself
//				JMate.Mute('Microphone', !audible, true);
//			}
//		}
//
//	}
//});
JMate.on('OnConnectionError',function(e,code){
	VideoMost.log('OnConnectionError',code);
	var msg;
	switch(code) {
        case Strophe.Status.DISCONNECTED:
		case Strophe.Status.ERROR:
		case Strophe.Status.CONNFAIL:
			if(JMate.intentDisconnect){
				msg = null; //no mesasge on disconnection - just wait for reconnect
			}else{
//				msg = _('the connection was broken');
				msg = _('session will be restored in some seconds');
				var checkConn = function(){
					if(trynum >= maxTry){
						//oups
						loadingState('err',_('the connection was broken'));
						return;
					}
					trynum++;
					VideoMost.log('Trying to connect...');
					setTimeout(function(){
						//TODO: remove duplication with XMan.selectService upper 
						XMan.selectService(["wss://"+gVMSets.xmpp_server+":"+gVMSets.xmpp_websocket_port+"/ws/",'http-bind/'], function(s){
							//succ
							//check jconf ready
							VMC.startJconfSession(function(){
								//wait. in case of
								setTimeout(function(){
									//refresh it all
									window.location.reload();
								}, 1000);
							},function(){
								checkConn();
							});
						},function(){
							checkConn();
						});
					}, 3000);
				};
				checkConn();
			}
			break;
        case Strophe.Status.AUTHFAIL: 
        	msg = _('authorization error'); 
        	break;
        default: 
        	msg = _('unknown error');
    }
	if(msg)
		messageDlg.showFailInfo(msg);
});
JMate.on('OnError',function(e,code, arg){
	VideoMost.log('OnError',code, arg);
	switch (code) {
	case 'ERR_MEDIA':
		if(arg.name== 'PermissionDeniedError' && arg.message.indexOf('secure') != -1 ){
			loadingState('err', _('OnlySecureOrigins'));
		}else
			loadingState('err',_('CamBusy_msg'));
		break;
	case 'ERR_REMOTESDP':
//		loadingState('err',_('Wrong SDP: ')+arg.message);
		break;
	case 'ERR_REJECTED':
		loadingState('err',_('participants exceeds limit'));
		break;
	case 'ERR_DISCONNECTED':
//		loadingState('err',_('the connection was broken'));
		if(!WMUsersO.getUserIm()|| !WMUsersO.getUserIm().Attribs.banned){
			$.ajax({
				dataType: "json",
				type: 'POST',
				url: service_url+'ext/vmi',
				data: {task: 'isConfEnded', confid: confopts.a.confid},
				success: function(data){
					if(data.isConfEnded){
						//in case of conf was finished
						if(ConfUI.endConfHandler && ConfUI.endConfHandler.endConfFlag)
							ConfUI.endConfHandler.openFeedbackDialog();
						else {
							loadingState('err',_('Conference finished'));
						}
					}else{
						//default message
						disconnectHandle();
					}
				}
			})
				.fail(function(){
					loadingState('err',_('the connection was broken'));
				});
		}
		break;

	default:
		break;
	}
});
JMate.on('OnMediaAccepted WRTC.OnReloginStarted',function(e,code, arg){
	loadingState('init');
});


JMate.on('OnMediaAccepted',function(e,code, arg){

	//fill device lists
	var kinds = ['videoinput', 'audioinput', 'audiooutput'];
	VideoMost.vmClient.collectDevices(function(ok){
		if(!ok){
			VideoMost.log("error on devices collecting");
			return;
		}

		var safariMockDevice = false;
		var audioMenu = null;
		$.each(kinds, function(i, kind){
			var dlist = VideoMost.vmClient.getDeviceList(kind);
			if(!dlist){
				//no such type devices
				switch(kind) {
					case 'videoinput':
						$('.video-parent-element').remove();
						break;
					default: break;
				}
				return;
			}
			//-----
			var current = null;
			var saved = UserPrefs.get(kind);
			if(saved){
				//check saved in list
				$.each(dlist , function(i, el){
					if (el.label.indexOf("Mock") == 0) {
						safariMockDevice = true;
					}
					VideoMost.log("device el.label: " + el.label + ", el.id: " + el.id, 'debug');
					var devId = $.browser.safari ? el.label : el.id;
					VideoMost.log('device',devId);
					if(devId == saved){
						current = el.id;
						return false; //break
					}
				})
			}
			if(!current){
				current = VideoMost.vmClient.getDevice(kind);
				VideoMost.log("current (device) not found, take: " + current, 'debug');
			} else {
				VideoMost.log("current", kind, "has been gotten from saved: ", current, 'debug');
			}

			var ok = true;
			// abag : temporary workaround for Safari fake devices to cancel hangups
			// This was fixed in Safari 12.1
			if ($.browser.safari && safariMockDevice) {
				var ver = Phono.util.getSafariVersion();
				if (ver < 12.1) {
					ok = false;
				}
			}
			if (ok) {
				VideoMost.vmClient.setDevice(kind, current);
			}

			//-----
			var d = {};
			$.each(dlist, function(i, el){
				d[el.id] = el.label;
			});
			try{
				audioMenu = ConfUI.setSettingsDeviceLists(kind, d, current);
			}catch(e){
				VideoMost.log(e, 'error');
			}
		});

		// add disable/enable audio-item into audio-menu

		if(typeof audioMenu === 'undefined') {
			var parentElem = $('.audio-parent-element');
			var audioMenu = new DropdownMenu(parentElem);
			audioMenu.load();
		}
		audioMenu.addHr();
		var $divElem = $('<div/>');
		var $switchSoundElem = audioMenu.addjQueryElement($divElem, _('Disable audio'));
		$switchSoundElem.children().attr('data-type', 'vol');
		$switchSoundElem.on('click', function(e){
			var isActive = $(this).hasClass('active');
			var newstate = !isActive;
			debug('vol/'+ newstate);
			if(VMTransUtils.isWrtc) {
				setMuteSpeakers(newstate);
			} else {
				DoSpeakerMute(newstate);
			}
			if(isActive) {
				$(this).removeClass('active');
			} else {
				$(this).addClass('active');
			}
			var currentLabel = newstate ? _('Enable audio'):_('Disable audio');
			$('p', $switchSoundElem).text(currentLabel);
		});

		var kindsDevices = {'videoinput':_('Camera'), 'audioinput':_('Microphone'), 'audiooutput':_('Audio')};
		if(browser.mozilla || browser.safari){
			delete kindsDevices['audiooutput'];
		}
		$.each(kindsDevices, function(kind, title){
			var set = $("." + kind + "-list").children(".dropdown-menu__item");
			set.on('click', function(){
				var val = $(this).attr('data-property');

				VideoMost.vmClient.setDevice(kind, val);
				var save_val = $.browser.safari ? this.getOptions()[val] : val;
				UserPrefs.set(kind, save_val)
			});
		});
	});
	
});

JMate.on('OnShowPermissionBox',function(e,code, arg){
	loadingState('needpermission');
});

JMate.on('OnAllowSoundPlaybackBox',function(e, callback_){
	var audioDialog = confirmDlgClass.New({
		dlgcfg: {
			dialogClass: 'confmessage-dialog',
			width: 400,
			modal: true
		},
		texts: {title: _('Allow sound playback?')}
	});
	audioDialog.init();
	audioDialog.setOption({
		buttons: [
			{
				text: _("Not allow"),
				click: function () {
					callback_(false);
					audioDialog.close();
				}
			},
			{
				text: _("Allow"),
				click: function () {
					callback_(true);
					audioDialog.close();
				}
			}
		]
	});
	audioDialog.show();
});

JMate.on('OnScreenSharingNotSupported', function(e, callback_){
	var msgDlg = confirmDlgClass.New({
		dlgcfg: {
			dialogClass: 'confmessage-dialog',
			width: 600,
			modal: true
		},
		texts: {
			title: _('Sorry, this browser does not support screen sharing.'),
		}
	});
	msgDlg.init();
	msgDlg.setOption({
		buttons: [
			{
				text: _("OK"),
				click: function () {
					msgDlg.close();
				}
			}
		]
	});
	msgDlg.show();
});

// abag rdp : this is an RDP master
JMate.on('OnStartRdpOperator', function(e, login){
	this._wm._rdpDataChannel.startConnection(login);
	this._wm._rdpMouseKbd.start();
	//this._wm._rdpWebsocket.start();
});
// abag rdp
JMate.on('OnStopRdp', function(e){
	this._wm._rdpDataChannel.stopConnection();
	if (!this._wm._rdpDataChannel.isRdpMaster()) {
		this.Sharing.stop();
	}
});
// abag rdp
JMate.on('OnRdpServerAbandoned', function(e){
	//this._wm._rdpDataChannel.stopConnection();
	this._wm._rdpDataChannel.sendDataCommand('rdpServerAbandoned');
});
// abag rdp
JMate.on('OnRdpServerOk', function(e){
	// Ask for start screensharing for RDP
	var that = this;

	this.Sharing.start(function(surface) {
		if (surface !== 'screen') {
			//that.Sharing.stop();

//			if (that.Sharing.wrtc_sh) {
//				that.Sharing.wrtc_sh.stopLocalStream();
//			}

			that.Sharing.stopForRestart();
			that._wm.jmate.setOutputToCamera();

			//that.setOutputToCamera();

			var msg = _('please_select_entire_screen_sharing');
			messageDlg.showInfoWithOk(msg, "", function() {
				that.trigger('OnRdpServerOk');
			});
		}
	});

});
// abag rdp
JMate.on('OnRemoteRdpAbandoned', function(e, callback_){
	messageDlg.close();
	var msg = _('connection_request_was_declined_by_the_peer');
	messageDlg.showInfoWithOk(msg);
});
// abag rdp
JMate.on('OnDataChannelCanceled', function(e, callback_){
	// Hide local RDP button if still fired
	VideoMost.RemoteDesktop.stopControlUser();
});
// abag rdp
JMate.on('OnRemoteRdpCanceled', function(e, callback_){
	VideoMost.RemoteDesktop.stopControlUser();
	messageDlg.close();
	var msg = _('connection_was_canceled_by_the_peer');
	messageDlg.showInfoWithOk(msg);
});
// abag rdp
JMate.on('OnRemoteRdpNoRdpServer', function(e, callback_){
	VideoMost.RemoteDesktop.stopControlUser();
	messageDlg.close();
	var msg = _('peer_cant_connect_rdpServer');
	messageDlg.showInfoWithOk(msg, '');
});
// abag rdp : remote part would control this side
JMate.on('OnRemoteRdpMasterStarted', function(e, login){
	this._wm._rdpWebsocket.start();
	//// Ask for start screensharing for RDP
	//this.Sharing.start();
});
// abag rdp : remote part allowed rdp sharing
JMate.on('OnRemoteRdpSharingStarted', function(e){
	messageDlg.close();
});
// abag rdp : say other party that sharing started (close wait window)
JMate.on('LocalSharingStarted', function(e){
	this._wm._rdpDataChannel.sendDataCommand('rdpSharingStarted');
});
// abag rdp
JMate.on('LocalSharingStopped', function(e){
	this._wm._rdpDataChannel.sendDataCommand('rdpSharingStopped');
	//this._wm._rdpDataChannel.stopConnection();
});
// abag rdp
JMate.on('LocalRdpNoRdpServer', function(e){
	this._wm._rdpDataChannel.sendDataCommand('OnRemoteRdpNoRdpServer');
	var jm = this._wm.jmate;
	messageDlg.close();
	var msg = _('cant_connect_rdpServer');
	//messageDlg.showInfoWithOk(msg);

	var param = {
		title:"",
		cancelBtn : {
			text:"Close",
			cbk:null
		},
		downloadBtn : {
			//text: "Install Remote Control Server",
			text: _('install_rdp_server'),
			cbk: function (e) {
				jm.installRdpServer(e);
			}
		},
		runRdpServerBtn : {
			text: _('run_rdp_server'),
			cbk:function (e) {
				window.open("Videomost-RemoteControl:");
			}
		}
	};

	messageDlg.showInfoWithLink(msg, param);
});
// abag rdp
JMate.on('LocalRdpCanceled', function(e){
	this._wm._rdpDataChannel.sendDataCommand('OnRemoteRdpCanceled');
});

// abag rdp
JMate.on('OnRdpShowWaitingWhileRemoteAllows', function(e) {
	var that = this;
	messageDlg.showInfoWithCancel(_('waiting_while_remote_allows'), _('remote_control'),
			function () {
				that.stopRdp();
			});
});

var trynum = 0,
	maxTry = gVMSets.adm_max_reconnect_attempts || 5;
//JMate.on('OnConferenceDisconnect',function(e,code, arg){
var disconnectHandle = function(){
	//already try?
	if(trynum > 0)
		return;
	
	loadingState('err',_('session will be restored in some seconds'));
	var connectionTrying = function(){
		console.debug('try', trynum);
		if(trynum >= maxTry){
			//oups
			loadingState('err',_('the connection was broken'));
			return;
		}
		trynum++;
		
		setTimeout(function(){
			
			JMate.restoreJconfSession(function(){
				//successfull started conf
				VideoMost.log('try successfull','debug');
				trynum = 0;
				//TODO: remove this hack and repair ff reenter(some ice related error)
				if($.browser.mozilla){
					window.location.reload();
				}
			}, function(){
				VideoMost.log('another try to restore','debug');
				//another try to restore
				connectionTrying();
			});
		}, 2000);
	}
	connectionTrying();
};
};
