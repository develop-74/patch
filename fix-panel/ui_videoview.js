(function(){
//	function jqescape(s){
//		var e = '!"#$%&\'()*+,./:;<=>?@[]^`{|}~'.split('').join('|\\');
//		return s.replace(new RegExp('('+e+')','g'),'\\\\$1')
//	}
	var V = VideoMost;
	
	V.JMateClass.UIVideViewClass = RootClass.New({
		$el: null,
		vconts:{},
		streams:{},
		$loEl: null,
		$vEl: null,
		$pEl: null,
		CONT_CLASS:'videocontainer',
		LO_CLASS: 'remotes_layout',
		VIDEOS_CLASS: 'videos_class',
		PHS_CLASS: 'placeholders_class',
		_jmate: null,
		_RebuildTimeout: null,
		/**
		 * {<jid>:{user, hasStream, showDummy, dummyCandidateAt<ustime>}}
		 */
		_usersShown: null,
		/**
		 * @memberOf JMate.UIVideView
		 */
		init: function(o){
			this._maxusersshown = this._cur_maxusersshown = o.maxshown;
			var that = this;
			
			this._usersShown = {};
			that._jmate = o.jmate;
			
			that._jmate.on("WRTC.OnAddMixerStream",this.addMixerStream.bind(this));

			that._jmate.on("WRTC_SH.OnRemoveStream",this.removeStream.bind(this));

			that._jmate.on("OnPartyPriorityChange", this.rebuildLayout.bind(this));
			that._jmate._VMUsers.on('OnPartyAttrChanged', function(e,u,a,v){
				V.log('VMUsers.on(OnPartyAttrChanged)')
				if(!u.Im && a == 'visible'){
					that.rebuildLayout();
				}
			});
			that._jmate.on("OnConnectionError", this.reset.bind(this));
			
			that._jmate._VMUsers.on("OnAddUser",this.onAddUser.bind(this));
			that._jmate._VMUsers.on("OnDelUser",this.onDelUser.bind(this));
			that._jmate.on("OnAddUserStream",this.onAddUserStream.bind(this));
			that._jmate.on("_onStatsUpdate",this.onStatsUpdate.bind(this));
			
			return this;
		},
		setEl: function($el){
			if(this.$el) 
				this.$el.empty();
				
			this.$el = $el;
			this.$loEl = $('<div class="'+this.LO_CLASS+'"/>');
			this.$vEl = $('<div class="'+this.VIDEOS_CLASS+'"/>');
			this.$pEl = $('<div class="'+this.PHS_CLASS+'"/>');
			this.$el.append(this.$loEl);
			this.$loEl.append(this.$vEl);
			this.$loEl.append(this.$pEl);
		},
		/**
		 * reset state
		 */
		reset: function(){
			this.streams = {};
			this.vconts = {};
			this._usersShown = {};
			if(this.$vEl){
				this.$vEl.empty();
			}
		},
		makeView: function(user){
			var jid = user.Login;
			var that = this;
			var $container = $('<span data-jid="'+jid+'" class="'+this.CONT_CLASS+(user.Im ?' view_self':'')+'"/>');
			var	$vid = $('<video autoplay="true" />');
			$dummy = $('<div class="view_dummy" />');
			var $nick = $('<span class="nick"/>').text(user? user.Name : jid);
			$container.append($dummy);
			$container.append($vid);

			$container.append($nick);
		
			$container.click(function(){
				if(that.isActiveSpeakerMode === true) {
					return false;
				}
				that._jmate.trigger('OnUserViewClick', user);
			});


			$vid[0].addEventListener('loadedmetadata', function (e) {
				that.adjustVideo($container);
			});

			this._jmate.trigger('_onUserViewAdded',user, $container);
	        //
	        return $container;
		},

		removeView: function(jid){
//			delete this.streams[jid];
			this.rebuildLayout();
		},

		_mix: null,
		_$mixCont: null,
		enableMixMode: function(mix){
			this._mix = mix;
			if(mix){
				this._makeMixLayout();
			}
		},
		_makeMixLayout: function(){
			var	$vid = $('<video autoplay="true" />');
			$vid.width('100%')
			$vid.height('100%')
			this.$el.append($vid);
			this._$mixCont = $vid;
			this.$loEl.hide();
		},
		_mixerStream: null,
		addMixerStream: function(e, stream){
			if (this._mixerStream === stream) {
				return;
			}
			this._mixerStream = stream;
			if (this._$mixCont) {
				WRTCA.attachMediaStream(this._$mixCont[0], stream);
			} else {
				V.log("Trying to attach video mixerStream to non-existing video element", 'warn');
			}
		},
		/**
		 * on new user enter
		 */
		onAddUser: function(e, user){
			V.log('onAddUser')
			//check that user needs to be shown
			this.rebuildLayout();
		},
		onDelUser: function(e, user){
			V.log('onDelUser')
			//check that deleted user was shown
			var udesc = this._usersShown[user.Login];
			if(!udesc){
				return;
			}
			this.rebuildLayout();
		},
		onStatsUpdate: function(e, stat){
			//check that user shown and state changed
			var udesc = this._usersShown[stat.jid];
			if(!udesc){
				return;
			}
			var novideo = this.isVideoNotPresent(stat)

//			V.log('onStatsUpdate',stat.jid, novideo)
			var $cont = this.vconts[stat.jid];
			if(udesc.showDummy && !novideo){
				//hide dummy
				V.log('hide dummy',stat.jid, novideo)
				$cont.find('.view_dummy').hide();
				$cont.addClass('no_video');
				udesc.showDummy = false;
				udesc.dummyCandidateAt =  null;
			}else if(!udesc.showDummy && novideo){
				var now = (new Date).getTime();
				if(!udesc.dummyCandidateAt){
					udesc.dummyCandidateAt = now;
				}
				if(udesc.dummyCandidateAt && (now - udesc.dummyCandidateAt > 4000) ){
					udesc.dummyCandidateAt =  null;
					//show dummy
					V.log('show dummy',stat.jid, novideo)
					$cont.find('.view_dummy').show();
					$cont.removeClass('no_video');
					udesc.showDummy = true;
				}
			}
//			this.rebuildLayout();
		},
		onAddUserStream: function(e, user){
			V.log('onAddUserStream')
			//check that user was shown
			this.rebuildLayout();
		},

		/**
		 * on remove stream event handler
		 */
		removeStream: function(e, jid, stream) { // stream - abag
			// remove only known stream / filter dropped streams
			// abag : needed for the case when onremovestream() by some reason comes after onaddstream() for the same remote peer (page refresh). 
			V.log("removeStream() 1 jid = " + jid, 'debug');
			if (!stream || (this.streams[jid] && this.streams[jid].id == stream.id)) {
				this.removeView(jid);
			}
		},

		/**
		 * Flag for checking
		 * active speaker layouts(onea, oneplusa)
		 * @type {boolean}
		 */
		isActiveSpeakerMode: false,

		/**
		 * Flag for checking 'oneplusa' layout
		 * @type {boolean}
		 */
		isOneSpeakerMode: false,

		/**
		 * Store current active speaker user
		 * @type {VMUserClass} user|null
		 */
		activeUser: null,
		//----
		/**
		 * maximum of users to show at time
		 */
		_maxusersshown: 1,//default
		_cur_maxusersshown: 1,
		/**
		 * layout type string holder
		 */
		_loType: 'oneplus', //default
		/**
		 * for external call on changing layout type
		 */
		setLayout: function(type){
			if(this._loType == type && this.isActiveSpeakerMode !== true)
				return; //do nothiing, cos nothing change
			var f = this['buildLO'+type];

			$(".videocontainer__active-state").removeClass("videocontainer__active-state");

			if(type === 'onea') {
				this.isActiveSpeakerMode = true;
				this.isOneSpeakerMode = true;

				if(this.activeUser === null) {
					var currentUser = this._getRandomRemoteUser();
					if(currentUser !== null) {
						vmLOM.enMode('fixto', currentUser);
					}
				}
				else {
					var currentUser = this._jmate._VMUsers.getUser(this.activeUser);
					vmLOM.enMode('fixto', currentUser);
				}

			} else if(type === 'oneplusa') {
				this.isActiveSpeakerMode = true;
				this.isOneSpeakerMode = false;

				if(vmLOM.isMode('fixto')){
					// it's not error but it work
					vmLOM.disMode('fixto');
					vmLOM.disMode('fixto');
				}

				if(this.activeUser !== null) {
					var currentUser = this._jmate._VMUsers.getUser(this.activeUser);
					this._jmate._VMUsers.setMaxPriorityToUser(currentUser);
				}
			}
			else {
				this.isActiveSpeakerMode = false;
				this.isOneSpeakerMode = false;
				$state = $('#remoteVideos').find('[data-jid="' + this.activeUser + '"]');
				$state.addClass('videocontainer__active-state');

				if(vmLOM.isMode('fixto')){
					// it's not error but it work
					vmLOM.disMode('fixto');
					vmLOM.disMode('fixto');
				}
			}

			if(!f){
				type = 'oneplus';
			}
			
			this._loType = type;
			
			// abag vmixer
			if (!this._mix) {
				this.rebuildLayout();
			}
//			this.adjustCurrentLO();
			//// for Spectrum
			///this._jmate.trigger('OnRebuildLayout', type);
		},
		
		rebuildLayout: function(){
			//skip on mix or not inited
			if(this._mix === true || this._mix === null){
				return;
			}
			var that = this;
			
			//skip unnecessary calls
			if(that._RebuildTimeout)
				clearTimeout(that._RebuildTimeout);
			//timeout for skip addStream spam on conference enter
			that._RebuildTimeout = setTimeout(function(){
				that._RebuildTimeout = null;
				that._rebuildLayout();
			}, 100);
		},
		_rebuildLayout: function(){
			var that = this;
			//prevent from early call XXX:?
//			if(!window.WMUsersO)
//				return;
			//in case of el is not defined - do nothing
			if(!this.$el)
				return;
			//get and sort users
			var users = [];
			//common user streams case
			that._jmate._VMUsers.eachUser(function(i, u){
				//skip me
				if(u.Im)
					return;
				//skip disabled by moderator
				if(!u.ga('visible') || u.ga('banned'))
					return;
				users.push(u);
			});
			users.sort(function(a,b){
				return b.ga('priority') - a.ga('priority');
			});
//				V.log('starconfd', users, users[0] &&users[0].ga('priority'),users[1]&&users[1].ga('priority'), 'warn')
			//TODO:Attach ALL audios!
			var toshow = Math.min(users.length,this._cur_maxusersshown);
//			crop users to toshow val
			users = users.slice(0, toshow);
			//add myself if needed
			if(that._jmate.confConn.GetOption('localVideoInRemotes')){
				var me = that._jmate._VMUsers.getUserIm();
				if(this.isOneSpeakerMode){
					if(this.activeUser == me.Login){
						//add me, remove other
						users = [me];
					}else{
						//dont change user or set it to me if none
						if(!users.length){
							users = [me];
						}
					}
				}else{
					if(me.ga('visible')){
						users.push(me);
					}
				}
			}
//			V.log('starconfd BUILD', users[0] && users[0].Name +'/'+users[0].ga('priority'), 'warn')
//			make lo
			V.log('rebuild w users:',$.map(users, function(u){return u.Name}).join(','))
			this.buildCurrentLO(users);

			this.renewVideos(users);

			// for Spectrum
			this._jmate.trigger('OnRebuildLayout', null);
		},
		PLACEHOLDER_CLASS: 'placeholder',
		buildCurrentLO: function(users){
			//purge current containers
			this.$pEl.empty();//children().not('.'+this.VIDEOS_CLASS).remove();

			this['buildLO'+this._loType](users);
		},
		buildLOoneplus: function(users){
			var total = users.length;

			var mainW = this.$el.width(),
				mainH = this.$el.height();
			
			var $ph0 = this.makePlaceholder(0);
			this.$pEl.append($ph0);

			if(total == 1){
				this.adjustAspect($ph0.find('.aspkeeper'), mainW, mainH);
				//TODO: merge this cases into one
			}else if (total <= 6){
				var mainWidth = mainW*(2/3);
				var onTop = total%4;
				if(total <= 4){
					mainVHeight = mainH*(2/3);
					onTop = 0;
					
					mainWidth =  mainW;
				}
				var main_dim = this.adjustAspect($ph0.find('.aspkeeper'), mainWidth, mainH*(2/3));
				var eldim = [main_dim[0]/(total-1-onTop-!!onTop),main_dim[1]/2];
				
				var $main_wrapper = $('<div style="display:inline-block; width:100%"/>');
				this.$pEl.append($main_wrapper);
				//reattach main to wrapper
				$main_wrapper.append($ph0);
				if(onTop){
					var $main_right = $('<div style="display:inline-block"/>').width(eldim[0]);
					$main_wrapper.append($main_right);
					
					for(var i = 1; i < onTop+1; i++){
						var $ph = this.makePlaceholder(i);
						$main_right.append($ph);
					}
				}
				
				for(var i = onTop+1; i < total; i++){
					var $ph = this.makePlaceholder(i);
					//add view to html
					this.$pEl.append($ph);
				}
				this.adjustAspect(this.$pEl.find('.'+this.PLACEHOLDER_CLASS)
						.not($ph0)
						.find('.aspkeeper'), eldim[0], eldim[1]);
			}else{
				var mainVHeight = mainH*0.6;
				var onTop = 3;// max of side videos
				
				//optimize. may be later...
//				if(total <= 4){
//					mainVHeight = mainH*(2/3);
//					onTop = 0;
//				}else if(total <= 6){
//					mainVHeight = mainH*(2/3);
//					onTop = 2;
//				}
				var eldim;
				var main_dim;
				var video_dim;
				
				onTop++;
				do{
					onTop--;
					//get sizes of main
					
					eldim = this.calcGridEl(mainW, mainH - mainVHeight, total-1-onTop);
					video_dim = calcRect(eldim[0], eldim[1], this.vidaspect[0], this.vidaspect[1]);
					main_dim = this.adjustAspect($ph0.find('.aspkeeper'), (mainW-(onTop?video_dim[0]:0)), mainVHeight);
					
				} while( onTop && (main_dim[1] / onTop < video_dim[1]));
//				var eldim = [main_dim[0]/2,main_dim[1]/2];
				
				var $main_wrapper = $('<div style="display:inline-block; width:100%"/>');
				this.$pEl.append($main_wrapper);
				//reattach main to wrapper
				$main_wrapper.append($ph0);
				if(onTop){
					var $main_right = $('<div style="display:inline-block"/>').width(video_dim[0]);
					$main_wrapper.append($main_right);
					
					for(var i = 1; i < onTop+1; i++){
						var $ph = this.makePlaceholder(i);
						$main_right.append($ph);
					}
				}
				
				for(var i = onTop+1; i < total; i++){
					var $ph = this.makePlaceholder(i);
					//add view to html
					this.$pEl.append($ph);
				}
				this.adjustAspect(this.$pEl.find('.'+this.PLACEHOLDER_CLASS)
						.not($ph0)
						.find('.aspkeeper'), eldim[0], eldim[1]);
				
			}
		},
		buildLOgrid: function(users){
			var mainW = this.$el.width();
			var mainH = this.$el.height();
			
			var eldim = this.calcGridEl(mainW,mainH, users.length);
			
			for(var i = 0; i< users.length; i++){
				var $ph = this.makePlaceholder(i);//(u.Login);
				//add view to html
				this.$pEl.append($ph);
				
			}
			this.adjustAspect(this.$pEl.find('.'+this.PLACEHOLDER_CLASS+' .aspkeeper'), eldim[0], eldim[1]);
		},
		calcGridEl: function(mainW, mainH, total){
			if(total == 0){
				//TODO: check other code for total == 0
				return [0,0];
			}
			var field_aspect = mainW/mainH,
				video_aspect = this.vidaspect[0]/ this.vidaspect[1];
			var norm_aspect = field_aspect/ video_aspect;
			var frows = Math.sqrt( total / norm_aspect );
			var fcols = frows * norm_aspect;

			function roundrc(v, total){
				var rv = Math.round(v);
				//for extreme values
				rv = rv || 1;//cant be zero
				rv = Math.min(rv, total);//couldn't be greater than total
				
				var pair = Math.ceil(total/rv);
				return [rv, pair];
			}
			
			var cw, ch;
			//try frows
			var rbase = roundrc(frows, total);
			var rcw = mainW/rbase[1];
			var rch = mainH/rbase[0];
			var rbaspect = Math.abs(rcw/rch - video_aspect);
			//try fcols
			var cbase = roundrc(fcols, total);
			var ccw = mainW/cbase[0];
			var cch = mainH/cbase[1];
			var cbaspect = Math.abs(ccw/cch - video_aspect);
			
//			choose best
			if(rbaspect < cbaspect){
				cw = rcw;
				ch = rch;
			}else{
				cw = ccw;
				ch = cch;
			}
//			console.debug('>>>',cw,ch,'>',rows,cols);
			return [cw, ch];
		},
		/**
		 * aspect of video block in layout
		 */
		vidaspect: [16,9],
		/**
		 * sets aspect of video block to vidaspect 
		 */
		adjustAspect: function($container, cw, ch){
//			var fvu = false;
//			//handle sharing video case
//			if(this._fitViewUser){
//				var fvuLogin = this._fitViewUser.Login;
//				if(this.vconts[fvuLogin] == $container){
//					fvu= true;
//				}
//			}
			
	        var i = this._fitViewUser ? [cw, ch] : calcRect(cw, ch, this.vidaspect[0], this.vidaspect[1]);
	        $container.width(i[0]);
	        $container.height(i[1]);
	        return i;
		},
		/**
		 * crop video indents to fill parent container
		 * @param {JQuery} $container
		 * @param {boolean} [force=false] if true stretch regardless of previous size check(optimization) 
		 */
		adjustVideo: function($container, force){
			var stretch = this._fillVideos;
//			V.log('==== going to stretch ====',stretch,'jid:',$container.data('jid'))
			//is this block needed? 
			//handle sharing video case
			if(this._fitViewUser){
				var fvuLogin = this._fitViewUser.Login;
				if(this.vconts[fvuLogin] == $container){
					stretch= false;
				}
			}
			
			function percent(p, from){
				return ((p/from)*100)+'%';
			};
			var $vid = $container.find('video');
			if(stretch){
				var curSize = {
					w: $vid[0].videoWidth,
					h: $vid[0].videoHeight
				}
				//adjust only if video dimensions changed
				var lastSize = $vid.data('lastSize');
				if(!force && lastSize && lastSize.w == curSize.w && lastSize.h == curSize.h){
					//video not changed
					return;
				}else{
					$vid.data('lastSize', curSize);
				}
				
				var pwidth = this.vidaspect[0],
					pheight = this.vidaspect[1];
				var i = calcRect(pwidth, pheight, curSize.w, curSize.h, stretch);
//				V.log(`==: a:${pwidth}/${pheight}. vid size:${curSize.w}/${curSize.h}. result:`,i);
				$vid.width( percent(i[0], pwidth) );
				$vid.height( percent(i[1], pheight) );
				
				$vid.css('top',percent( (pheight - i[1])/2 , pheight) );
				$vid.css('left',percent( (pwidth - i[0])/2, pwidth) );
			}else{
				$vid.width( '100%' );
				$vid.height( '100%' );
				
				$vid.css('top',0 );
				$vid.css('left',0 );
			}
//			V.log('==== /stretch ====');
		},
		/**
		 * Should remote videos be stretched to fit its containers or not
		 * @param {boolean} yes
		 */
		fillVideos: function(yes){
			this._fillVideos = yes;

			for(var c in this.vconts){
				var $cont = this.vconts[c];
				this.adjustVideo($cont, true);
			}
		},
		_fillVideos: true,
		makePlaceholder: function(i){
			var $cont = $('<span class="'+this.PLACEHOLDER_CLASS+' '+this.PLACEHOLDER_CLASS+'_'+i+'"/>');
			$cont.append($('<div class="aspkeeper"/>'));
			return $cont;
		},

		// abag : for Safari incoming audio
		addHiddenVideo: function() {
			var hvid = "hiddenVideo";
			if (!document.getElementById(hvid)) {
				$hv = $('<video width="1" height="1" id=' + hvid + ' autoplay="autoplay" style="position:absolute;"></video>');
				$('body').prepend($hv);
			}
		},

		renewVideos: function(users){
			// abag : for Safari incoming audio
			this.addHiddenVideo();
			var that = this;
			//find dropped videos
			this.$vEl.find('.'+this.CONT_CLASS).each(function(i, cont){
				var jid = cont.getAttribute('data-jid');
				var rem = true;
				//check that video exists in user list
				for(var j = 0; j < users.length; j++){
					if(users[j].Login == jid){
						rem = false;
						break;
					}
				}
				//remove if not
				if(rem){
					$(cont).fadeOut(1000,function(){
							$(this).remove()
						});
					delete that.vconts[jid];
					delete that._usersShown[jid];
				}
			});
			
			//add new users
			for (var i = 0; i < users.length; i++){
				var u = users[i],
					jid = u.Login;
				var $ph = this.$pEl.find('.'+this.PLACEHOLDER_CLASS+'_'+i).find('.aspkeeper');
				var $cont = this.vconts[jid];
				if($cont){
					//animated move
					this.moveElTo($cont, $ph, true);
					//adjust video in case remote stream changed. Here we need timeout cos stream change is not immediate
					setTimeout((function($cont){
						that.adjustVideo($cont);
					}).bind(this, $cont), 150);
				}else{
					//make
					$cont = this.makeView(u);
					this.vconts[jid] = $cont;
					this._usersShown[jid] = {user:u, hasStream:false, showDummy:false}
					
					this.$vEl.append($cont);
					if(u.Im){
						that._jmate.setView({local:$cont})
					}
					//non animated move and fadeIn
					this.moveElTo($cont, $ph, false);
				}
				
				var uStream = u.PartyLnk.GetStream(); 
				
				//if user has stream and video bitrate, attach it
				if(!u.Im && uStream && !this._usersShown[jid].hasStream){
					WRTCA.attachMediaStream( $cont.find('video')[0], uStream);
					this._usersShown[jid].hasStream = true;
				}
			}
		},
		isVideoNotPresent: function(stat){
//			var stat = this._jmate._wm._wrtc._wrtcStats.getStatByJID(u.Login);
			return stat && stat._bytesPrev !== null && stat.bitrate == 0 && stat.framerate == 0;
		},
		resetUserView: function(user){
			var jid = user.Login;
			if(this.vconts[jid]){
				this.vconts[jid].remove();
				delete this.vconts[jid];
				delete this._usersShown[jid];
			}
		},
		moveElTo: function($el, $to, animated){
			var wrapPos = this.$pEl.position()
			var dest = $to.position();
			dest.top = dest.top + wrapPos.top;
			dest.left = dest.left + wrapPos.left;
			dest.width = $to.width();
			dest.height = $to.height();
			
			if(animated){
				$el.animate(dest, {
					duration: 500,
					queue: false,
					easing: 'easeOutCubic'
				});
			}else{
				$el.css(dest);
				$el.fadeIn(1000)
			}
		},
		
		/**
		 * which user dont crop video
		 */
		_fitViewUser: null,
		_saveMaxusersshown: null,
		setFitViewUser: function(u){
			var $fvuCont;// = this.vconts[u.Login]
			if(!u){
//				if(this._fitViewUser && !u){
				//if fvu reset - get old fvu
				if(this._fitViewUser)
					$fvuCont = this.vconts[this._fitViewUser.Login];
				
//				this._maxusersshown = this._saveMaxusersshown;
				this._cur_maxusersshown = this._maxusersshown;
				this._jmate._VMUsers.unFixPriority();
			}else{
				//if not - adjust new fvu
				$fvuCont = this.vconts[u.Login];
				
//				this._saveMaxusersshown = this._maxusersshown;
//				this._maxusersshown = 1;
				this._cur_maxusersshown = 1;
				this._jmate._VMUsers.fixPriorityToUser(u);
			}
			this._fitViewUser = u;
			//adjust fvu user
			if($fvuCont)
				this.adjustVideo($fvuCont);
			this.rebuildLayout();
			
		},
		setMaxUsersShown: function(n){
			//set current only if we are not in some spec states so default == current
			if(this._maxusersshown == this._cur_maxusersshown){
				this._cur_maxusersshown = n;
				this.rebuildLayout();
			}
			this._maxusersshown = n;
		},
		/**
		* Get random remote user
		* @method getRandomRemoteUser
		* @return {VMUserClass} user|null
		*/
		_getRandomRemoteUser: function(){
			var count = this._jmate._VMUsers.getUsersCount();

			for(var i = 0; i < count; i++) {
				var user = this._jmate._VMUsers.getUserByNum(i);

				if(!user.ga('visible') || user.ga('banned')) {
					continue;
				}

				if(user.Im === false) {
					return user;
				}
			}

			return null;
	   },
	});
	/**
	 * fit proportionally block in parent
	 * stretch to crop indents
	 */
	function calcRect(pw,ph,cw,ch,stretch){
		var pa = pw/ph,
			ca = cw/ch;
		var rh,rw;
		if(stretch){
			if(pa > ca){
				rw = pw;
				rh = pw / ca;
			}else{
				rw = ph * ca;
				rh = ph;
			}
		}else{
			if(pa > ca){
				rw = ph * ca;
				rh = ph;
			}else{
				rw = pw;
				rh = pw / ca;
			}
		}
		return [rw, rh];
	};
})();