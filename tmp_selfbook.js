const SELFBOOK_BASE_URL="https://sdk.selfbook.com",SELFBOOK_BASE_URL_V3="https://sdk-v3.selfbook.com",SELFBOOK_BASE_URL_LAYERS="%REACT_APP_SELFBOOK_BASE_URL_LAYERS%";let SELFBOOK_BACKEND_URL="https://api.selfbook.com/api/v2",SELFBOOK_BACKEND_URL_V3="https://api.selfbook.com/api/v3";const STATSIG_CLIENT_KEY="client-PV01TCjBc3a7zunh9brJUh2fIaLwbXaH7aQH2dFpSGW",STATSIG_EXPERIMENT="ddn",STATSIGN_SIGNAL_BOX_EXPERIMENT="ddn_signal_box";let SELFBOOK_APP_VERSION="v2",SELFBOOK_APP_BASE_URL=SELFBOOK_BASE_URL;const SELFBOOK_SCRIPT_ID="selfbook_jssdk",SELFBOOK_HOTEL_ID_PROP="hotelId",SELFBOOK_API_KEY_PROP="apiKey",SELFBOOK_WIDGET_ELEMENT_ID="selfbook_sdkwidget",SELFBOOK_WIDGET_WRAPPER_ELEMENT_ID="selfbook_sdkwidget_wrapper",SELFBOOK_WIDGET_LOADING_ELEMENT="selfbook-loading",IS_LANDING_PAGE_FLAG_ID="ddnLandingPage",BOOTSTRAP_ACTION="WIDGET/BOOTSTRAP",SELFBOOK_HOTEL_GROUP_INFO="selfbook_hotel_group_info",SELFBOOK_HOTEL_INFO="selfbook_hotel_info";window.selfbookStatsigClient=null;const BLACK_SQUARE_THEME_HOTELS=["6739"],THE_LINE_HOTELS=["68711","71661","2427"],COMPLETE_BOOKING_BTN_CLICK="Complete your reservation button click",ROUTE_PATHS={app:{confirmation:"/confirmation",wallet:"/wallet",account:"/account",settings:"/settings",reservations:"/reservations",reservationDetail:"/reservation-detail",editBooking:"/edit-booking",bookingConfirmed:"/booking-confirmed"}},INITIAL_PERSISTED_DATA={isExpired:!0,all:null,booking:null,core:null,router:null},GUEST_TYPE={ADULT:"adult",CHILD:"child",INFANT:"infants"};let initialV35AvailabilityStartEndDates={},initialCalendarResponse=null;function setOverflowHidden(e){const t=e?"hidden":"";document.body.style.overflow=t,document.documentElement.style.overflow=t}function getStatsigValue(e,t){if(window.selfbookStatsigClient){const n=window.selfbookStatsigClient.getExperiment(e);return n&&n.value&&n.value[t]}return null}const SUPPORTED_LOCALES=["en","fr","pt","da","de","de-DE","es-MX","it","ja","ko","nl","ro","ru","sq","sv","vi","zh","zh-CN","zh-TW","es"];function parseLocaleFromUrl(){try{const{pathname:e}=new URL(window.location.href),t=e.split("/").filter(Boolean),n=t[0]?.toLowerCase();if(!n)return null;if(!/^[a-z]{2}(-[a-z]{2})?$/i.test(n))return null;const o=n.replace(/^([a-z]{2})(-[a-z]{2})?$/i,(e,t,n)=>n?`${t.toLowerCase()}-${n.slice(1).toUpperCase()}`:t.toLowerCase());return SUPPORTED_LOCALES.includes(o)?o:"en"}catch{return null}}function appendWidgetScript({src:e,callback:t,type:n="text/javascript"}){const o=document.createElement("script");o.type=n,o.src=e,document.body.appendChild(o),t&&"function"==typeof t&&(o.onload=function(){t()})}function initFloatingSearchbar({apiKey:e,hotelId:t}={}){appendWidgetScript({src:`${SELFBOOK_BASE_URL_V3}/widgets/floating-search-bar.js`,type:"module",callback:function(){const n=SELFBOOK_BACKEND_URL.replace(/\/v[123]/,"");window.renderWidget(null,{backendURL:n,hotelId:t,apiKey:e})}})}function initDDNSignalBox({signalPartner:e,apiKey:t,hotelId:n}={}){e&&"none"!==e&&appendWidgetScript({src:`${SELFBOOK_BASE_URL_V3}/widgets/ddn-signal-box.js`,callback:function(){const o=SELFBOOK_BACKEND_URL.replace(/\/v[123]/,"");window.renderSBSignalBox({backendURL:o,hotelId:n,apiKey:t,ddn_signal_partner:e,experiment:"ddn_signal_box",locale:parseLocaleFromUrl()})}})}function initWidgets({apiKey:e,hotelId:t,hotelData:n}){if(n?.enable_direct_distribution_network&&(n?.enable_paypal_partner&&n?.enable_paypal||n?.enable_perplexity_partner)){initDDNSignalBox({signalPartner:getStatsigValue("ddn_signal_box","ddn_signal_partner"),apiKey:e,hotelId:t})}}function initSDKBus(){const e={},t={};window.sb_sdkBus={emit(n,o){t[n]||(t[n]=[]),t[n].push(o),e[n]?.length&&e[n].forEach(e=>e(o))},on(t,n){e[t]||(e[t]=[]),e[t].push(n)},off(t,n){e[t]&&(e[t]=e[t].filter(e=>e!==n))},pull(e){const n=t[e]||[];return t[e]=[],n}}}function checkStatus(e){if(e.status>=200&&e.status<300)return e;const t=new Error(e.statusText);throw t.response=e,t}async function parseJSON(e){try{const t=await e.text();if(!t)return;return JSON.parse(t)}catch(e){console.error("parseJSON: err: ",e)}}function intervalWrapper(e,t){const n=setInterval(e,t);return function(){clearInterval(n)}}function getHotelBasicData(e){try{const t=getFromSessionStorage(SELFBOOK_HOTEL_GROUP_INFO).hotels?.filter(t=>t.id==e),n=t?.[0]||{};return getIsEnableV35(n)&&(n.app_version="v3",n.enable_v3_new_ui_version=!0),n}catch(e){return console.error("getHotelBasicData: err: ",e),{}}}function getFromSessionStorage(e){try{return JSON.parse(sessionStorage.getItem(e))}catch(e){return console.error("getFromSessionStorage: err: ",{e:e}),{}}}function getPersistedData(e){try{const t=JSON.parse(e.getItem("persist:root"));if(!t)return INITIAL_PERSISTED_DATA;const n=JSON.parse(t.booking||"{}"),o=JSON.parse(t.core||"{}"),a=JSON.parse(t?.router||"{}"),{expireTime:r}=o,s=(Date.now()-new Date(o.interactionTime))/1e3;return{isExpired:s>r,all:t,booking:n,core:o,router:a}}catch(e){return console.error("getPersistedData: err: ",e),INITIAL_PERSISTED_DATA}}function fillGuestsFields(e=[],t){const n=t.default_adult_occupancy?t.default_adult_occupancy:2;return e?.map(e=>e.type===GUEST_TYPE.ADULT?{type:GUEST_TYPE.ADULT,count:parseInt(e.count)||n}:e.type===GUEST_TYPE.CHILD&&parseInt(e.count)>0?{type:GUEST_TYPE.CHILD,count:parseInt(e.count),age:parseInt(e.age)||1,special_request:e.special_request||""}:e.type===GUEST_TYPE.INFANT&&parseInt(e.count)>0?{type:GUEST_TYPE.INFANT,count:parseInt(e.count)||1,age:parseInt(e.age)||1,special_request:e.special_request||""}:void 0).filter(Boolean)}function buildRoomsGuests(e,t){const n=t.default_adult_occupancy?t.default_adult_occupancy:2,o=()=>Math.random().toString(36).slice(2),a=["adult","child","childAges","room2Adult","room3Adult","room4Adult"].some(t=>!!e[t]);if(e.guests?.length&&!a)return Array.from({length:4},(t,a)=>{const r=0===a?"guests":`guestsRoom${a+1}`;if(!e[r])return null;const s=e[r]?.map(e=>{const t=e?.type===GUEST_TYPE.ADULT?e?.count||n:e?.count,a=e?.type===GUEST_TYPE.CHILD&&"number"==typeof e?.age;return{type:e?.type,count:Number(t),guest_details:a?[{key:o(),age:Number(e?.age)}]:void 0}});return{key:0===a?"room1":o(),data:s}}).filter(Boolean);const r=t=>Number(e[t]||0),[s,i,l,c]=["roomCount","adult","child","infants"].map(r);if(s>1&&!r("room2Adult")){const e=i||n,t=Math.floor(e/s);let a=e%s;return Array.from({length:s},(e,n)=>{const r=a>=n+1?1:0;return{key:0===n?"room1":o(),data:[{type:GUEST_TYPE.ADULT,count:t+r}]}})}const d=[];return Array.from({length:4}).forEach((t,a)=>{const s=a+1,u=0===a?i||n:r(`room${s}Adult`);if(u){const t=[{type:GUEST_TYPE.ADULT,count:u}],n=0===a?l:r(`room${s}Child`),i=e[0===a?"childAges":`room${s}ChildAges`];i?i.split(",").forEach(e=>{t.push({type:GUEST_TYPE.CHILD,count:1,guest_details:[{key:o(),age:Number(e)}]})}):n&&t.push({type:GUEST_TYPE.CHILD,count:n}),0===a&&c>0&&t.push({type:GUEST_TYPE.INFANT,count:c}),d.push({key:0===a?"room1":o(),data:t})}}),d}function buildRedirectSynxisLink(e,t){let n=`https://be.synxis.com/?hotel=${t.id}&theme=${t.synxis_theme}&config=${t.synxis_config}`;try{if(e){const{startDate:t,endDate:o,promoCode:a,groupCode:r,guests:s,iataNumber:i,couponCode:l,destinationId:c,nights:d,rate:u,hotelId:p,roomCategory:_}=e;d&&(n+=`&nights=${d}`),t&&(n+=`&arrive=${t}`),o&&(n+=`&depart=${o}`),a&&(n+=`&promo=${a}`),r&&(n+=`&group=${r}`),i&&(n+=`&iataNumber=${i}`),l&&(n+=`&couponCode=${l}`),u&&(n+=`&rate=${u}`),c&&(n+=`&destinationId=${c}`),Array.isArray(_)?n+=`&roomCategory=${_.map(e=>e).join(",")}`:_&&(n+=`&roomCategory=${_}`),s&&s.length>0?("adult"===s[0].type&&(n+=`&adult=${s[0].count}`),s[1]&&"child"===s[1].type&&(n+=`&child=${s[1].count}`)):n+="&adult=1"}}catch(e){console.error("buildRedirectSynxisLink: err: ",e)}return n}function selectShowWidgetButtonCopies(e){return e.core.showWidgetButtonCopies||{}}function selectRoute(e){return e?.router?.location?e.router.location.pathname:ROUTE_PATHS.app.editBooking}function isObjectEqual(e,t){return JSON.stringify(e)===JSON.stringify(t)}function isTemplateDomainMatch(e,t){return e?.booking_template_domain&&t?.target?.href?.includes(e.booking_template_domain)}function getElementById(e){return document?.getElementById(e)}function getIsEnableV35(e){return!!SELFBOOK_APP_VERSION.match(/^v3/i)||(e?.enable_v3_new_ui_version||!1)}function getIsLayers(e){return"layers"===e?.app_version||!!SELFBOOK_APP_VERSION.match(/^layers/i)}function runDirectApplication(){console.info("(!) selfbook: widget initialization started");let e,t,n,o=!1,a=!1,r=!1,s=!1,i=!1,l=!1,c=!1;function d(e){try{const t=document.createElement("script");if(t.innerHTML='\n        !function(){var analytics=window.analytics=window.analytics||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error("Segment snippet included twice.");else{analytics.invoked=!0;analytics.methods=["trackSubmit","trackClick","trackLink","trackForm","identify","reset","group","track","ready","alias","debug","once","off","on","addSourceMiddleware","addIntegrationMiddleware","setAnonymousId","addDestinationMiddleware"];analytics.factory=function(e){return function(){var t=Array.prototype.slice.call(arguments);t.unshift(e);analytics.push(t);return analytics}};for(var e=0;e<analytics.methods.length;e++){var key=analytics.methods[e];analytics[key]=analytics.factory(key)}analytics.load=function(key,e){var t=document.createElement("script");t.type="text/javascript";t.async=!0;t.src="https://cdn.segment.com/analytics.js/v1/" + key + "/analytics.min.js";var n=document.getElementsByTagName("script")[0];n.parentNode.insertBefore(t,n);analytics._loadOptions=e};analytics._writeKey="c77UfR3BzZDUXmAth2DaHEA8kkKhDIU2";;analytics.SNIPPET_VERSION="4.15.3";\n        analytics.load("c77UfR3BzZDUXmAth2DaHEA8kkKhDIU2");\n        }}();\n      ',document.head.appendChild(t),e?.enable_triptease_script&&!c){const e=document.createElement("script");e.type="application/ld+json",e.innerHTML='{"@context": "http://schema.org/","@type": "SoftwareApplication","name": "SelfBook"}',document.head.appendChild(e);const t=document.createElement("script");t.src="https://onboard.triptease.io/bootstrap.js",t.async=!0,t.crossOrigin="anonymous",t.type="text/javascript",document.head.appendChild(t)}}catch(e){console.error("inject3rdPartyScripts: err: ",e)}}async function u({url:e,method:t,data:n,headers:o}){try{const a=await fetch(e,{method:t,body:n,headers:o});checkStatus(a);return await parseJSON(a)}catch(e){console.error("There was a problem with the fetch operation:",e)}}function p(o,a,s){if(!n)return;const i=getFromSessionStorage(SELFBOOK_HOTEL_GROUP_INFO);let l={};if(getIsEnableV35(a)){if("group"===i?.structure&&(o?.hotelId||o?.destinationId)||"single"===i?.structure||"multiple_properties"===i?.structure)if("group"===i?.structure&&o?.destinationId){const e=i?.hotels.find(e=>e.destination_id?.toLowerCase()===o.destinationId.toLowerCase());e&&(o.hotelId=e.id)}else o.hotelId=o?.hotelId||a?.id;if(a?.enable_direct_distribution_network&&"signalBox"!==o.userStartingPoint&&(a?.enable_paypal_partner&&a?.enable_paypal||a?.enable_perplexity_partner)){const e=getStatsigValue("ddn_signal_box","ddn_signal_partner");if("paypal"===e){const t=function(){const e=g();if(e)return"authenticated"===e?.state?.step&&!!e?.state?.identifier}();l=c?{}:{partner:e,signalBoxUserVerified:!!t,paypalData:t?y():null,shouldExecuteRegularFlow:(!t||!a?.is_default_date_logic_enabled||"single"!==i?.structure)&&s}}}}setOverflowHidden(!0),window.toggleShowSBSignalBox?.(!1);const u=getElementById("selfbook_sdkwidget"),p=getElementById("selfbook_sdkwidget_wrapper");window.selfbookWidgetStore||(p.appendChild(function(){const e=document.createElement("div");return e.id="selfbook-loading",e.style.color="white",e.style.marginRight="-50%",e.style.position="absolute",e.style.top="50%",e.style.left="50%",e.style.fontFamily="sans-serif",e.style.transform="translate(-50%, -50%)",e.innerHTML='<img src="https://sdk.selfbook.com/assets/selfbook_loading_logo.svg" height="20" width="100%">',e}()),p.style.zIndex=2147483646,p.style.height="100%",p.style.background="v2"===SELFBOOK_APP_VERSION?"rgba(0, 0, 0, .74)":"rgba(39, 39, 39, 0.74)",setOverflowHidden(!0)),function(e){if(!0===r)return;n&&n.length>0&&n.forEach(e=>{if(e.includes(".js")){const t=document.createElement("script");t.type="text/javascript",t.src=`${SELFBOOK_APP_BASE_URL}/${e}`,document.body.appendChild(t)}});e?.enable_direct_distribution_network||d(e);r=!0}(a);const _=setInterval(()=>{if(window.selfbookWidgetStore){const n=getIsLayers(a),r={hotelInfo:{...!n&&{hotelIdAsArg:!!o.hotelId},...n&&{hotelResponse:getFromSessionStorage(SELFBOOK_HOTEL_INFO)},apiKey:o.apiKey||t,hotelId:o.hotelId||e},bookingData:{...o,...l},...!n&&{hotelGroupInfo:getFromSessionStorage(SELFBOOK_HOTEL_GROUP_INFO)},roomsGuests:o.roomsGuests||void 0,shouldExecuteRegularFlow:!1===l?.shouldExecuteRegularFlow?l?.shouldExecuteRegularFlow:s,userIP:o.userIP?.country_code?o.userIP:void 0,version:o.version,isDdnLandingPageSource:c};!function(){const e=document.getElementById("selfbook-loading");e&&getElementById("selfbook_sdkwidget_wrapper").removeChild(e)}(),clearInterval(_),window.selfbookWidgetStore.dispatch({type:BOOTSTRAP_ACTION,payload:r}),"none"===u.style.display&&(p.style.zIndex=2147483646,p.style.height="100%",p.style.background="v2"===SELFBOOK_APP_VERSION?"rgba(0, 0, 0, .74)":"rgba(39, 39, 39, 0.74)",setOverflowHidden(!0)),setTimeout(()=>{u.style.display="block",u.setAttribute("class","slide-in")},20),setTimeout(()=>{const e=p.querySelector('[aria-modal="true"]');e&&e.focus()},250)}},100)}function _(){try{const{isExpired:e,core:t,booking:n}=getPersistedData(localStorage);if(e||!t?.hotel?.data?.id)return void function(){try{localStorage.removeItem("persist:root")}catch(e){console.error("removePersistedData: err",e)}}();const o=t.bootstrapArgs;f({...o,startDate:n.bookingForm.start_date.slice(0,10),endDate:n.bookingForm.end_date?.slice(0,10)||null,guests:n.bookingForm.guests,propertyId:n.bookingForm.property_id,persistActive:!0,hotelId:t.hotel.data.id})}catch(e){console.error("openPersistWidget: err",e)}}const m=async()=>await fetch(`${SELFBOOK_APP_BASE_URL}/asset-manifest.json`,{headers:{"content-type":"application/json"}}).then(e=>e.json()).then(e=>function(e){n=e.entrypoints}(e));function g(){try{return JSON.parse(localStorage.getItem("selfbook_ddn-signal-box_auth"))}catch(e){console.error("Unable to extract Signal box from local storage.")}}function y(){const e=g();if(e)return e?.state?.user?.paypal_data}async function f(n={}){try{if(o)return;n.currencyCode&&(n.currency=n.currencyCode,delete n.currencyCode),n.locale||(n.locale=function(){const e=location.pathname.match(/^\/([a-z]{2}(?:-[A-Z]{2})?)(\/|$)/)?.[1],t=new URLSearchParams(location.search),n=t.get("lang")||t.get("locale"),o=document.documentElement.lang,a=navigator.language||navigator.languages?.[0];return function(e){if(!e)return"en";const[t,n]=e.split(/[-_]/);return n?`${t.toLowerCase()}-${n.toUpperCase()}`:t.toLowerCase()}(e||n||o||a||"en")}());let a=n.shouldExecuteRegularFlow||!1;n.apiKey&&await k(n.apiKey,n.hotelId);const r=getHotelBasicData(n.hotelId||e);getIsLayers(r)&&await async function(e,t){try{l=!0;const n=await u({url:`${SELFBOOK_BACKEND_URL_V3}/hotels/${e}`,headers:{"content-type":"application/json","API-Key":t}});sessionStorage.setItem(SELFBOOK_HOTEL_INFO,JSON.stringify(n)),l=!1}catch(e){console.log(e)}}(n.hotelId||e,n.apiKey||t),console.log("args",n);const s=getIsEnableV35(r),c=getFromSessionStorage(SELFBOOK_HOTEL_GROUP_INFO),d="group"===c?.structure,_="single"===c?.structure,m=function(e,t=[]){if(!e||"object"!=typeof e||Array.isArray(e))return!1;for(const n in e){if(t.includes(n))continue;const o=e[n];if(null!=o&&!("string"==typeof o&&""===o.trim()||Array.isArray(o)&&0===o.length||"object"==typeof o&&!Array.isArray(o)&&0===Object.keys(o).length))return!0}return!1}(n,["version","selfbook","hotelId","destinationId"]);if(s&&!1!==n.shouldExecuteRegularFlow&&((/*!initialAPIsCallsExecuted && */_&&m||d&&!i)&&(a=!0),r?.is_default_date_logic_enabled?n.startDate&&n.endDate&&(_||d&&n.hotelId)&&(a=!0):a=!0),n.guests?n.guests=fillGuestsFields(n.guests,r):n.guests=[{type:GUEST_TYPE.ADULT,count:r.default_adult_occupancy?r.default_adult_occupancy:2}],r.redirect_to_synxis){const e=buildRedirectSynxisLink(n,r);return void window.open(e,"_blank").focus()}getIsEnableV35(r)&&(n.roomsGuests=buildRoomsGuests(n,r)),p(n,r,a),document.getElementsByTagName("html")[0].setAttribute("translate","no")}catch(e){console.error("bookNow: err: ",e)}}function h(){const e="\n      #selfbook_sdkwidget {\n        position: absolute;\n        width: 100%;\n        height: 100%;\n        top: 0px;\n        right: 0px;\n      }\n\n      .dismiss-btn-slide-in {\n        -webkit-transition: 500ms;\n        -moz-transition: 500ms;\n        transition: 500ms;\n        transform: translateX(0)!important\n      }\n\n      .dismiss-btn-slide-out {\n        -webkit-transition: 500ms;\n        -moz-transition: 500ms;\n        transition: 500ms;\n        transform: translateX(300px)!important\n      }\n\n      .dismiss-btn-slide-out span {\n        display: none;\n      }\n\n      .payment-summary-wrapper {\n        overflow: scroll!important;\n        -ms-overflow-style: none!important;\n        scrollbar-width: none!important;\n      }\n      .payment-summary-wrapper::-webkit-scrollbar {\n        display: none!important;\n      }\n\n      .dismiss-btn-resize-in {\n        width: 46px!important;\n        height: 46px!important;\n        transition: 500ms;\n        right: 30px!important;\n      }\n\n      .dismiss-btn-resize-in span {\n        display: none;\n      }\n\n      .dismiss-btn-resize-in:hover {\n        width: 217px!important;\n        height: 46px!important;\n        transition: all 300ms linear;\n        cursor: pointer;\n      }\n\n      .dismiss-btn-resize-in:hover span {\n        display: inline;\n        height: 20px!important;\n        overflow: hidden;\n      }\n\n      .dismiss-btn-resize-out {\n        width: 46px!important;\n        height: 46px!important;\n        transition: 500ms;\n        right: -100px!important;\n      }\n\n      .slide-in {\n        transform: translateX(100%);\n        -webkit-transform: translateX(100%);\n        animation: slide-in 0.8s forwards !important;\n        -webkit-animation: slide-in 0.8s forwards !important;\n        z-index: 2147483646;\n      }\n\n      .slide-out {\n        transform: translateX(100%);\n        -webkit-transform: translateX(100%);\n        animation: slide-out 1s forwards !important;\n        -webkit-animation: slide-out 1s forwards !important;\n        z-index: -2147483646;\n      }\n\n      @media screen and (max-width:495px) {\n        .slide-in {\n          transform: translateY(100%);\n          -webkit-transform: translateY(100%);\n          animation: slide-up 0.8s forwards !important;\n          -webkit-animation: slide-up 0.8s forwards !important;\n          z-index: 2147483646;\n        }\n        .slide-out {\n          transform: translateY(100%);\n          -webkit-transform: translateY(100%);\n          animation: slide-down 0.5s forwards !important;\n          -webkit-animation: slide-down 1s forwards !important;\n          z-index: -2147483646;\n        }\n      }\n\n      @keyframes slide-in {\n        100% {\n          transform: translateX(0%);\n        }\n      }\n\n      @-webkit-keyframes slide-in {\n        100% {\n          -webkit-transform: translateX(0%);\n        }\n      }\n\n      @keyframes slide-up {\n        100% {\n          transform: translateY(0%);\n        }\n      }\n\n      @-webkit-keyframes slide-up {\n        100% {\n          -webkit-transform: translateY(0%);\n        }\n      }\n\n      @keyframes slide-out {\n        0% {\n          transform: translateX(0%);\n        }\n        100% {\n          transform: translateX(100%);\n        }\n      }\n\n      @-webkit-keyframes slide-out {\n        0% {\n          -webkit-transform: translateX(0%);\n        }\n        100% {\n          -webkit-transform: translateX(100%);\n        }\n      }\n\n      @keyframes slide-down {\n        0% {\n          transform: translateY(0%);\n        }\n        100% {\n          transform: translateY(100%);\n        }\n      }\n\n      @-webkit-keyframes slide-down {\n        0% {\n          -webkit-transform: translateY(0%);\n        }\n        100% {\n          -webkit-transform: translateY(100%);\n        }\n      }\n    ",t=document.createElement("style");t.textContent=e,document.head.append(t),function(e){const t=document.createElement("style");t.textContent=e,document.head.append(t)}(e)}function S(e){const t={startdate:"startDate",enddate:"endDate",rateplancode:"ratePlanCode",rate:"rate",roomid:"roomId",propertyid:"propertyId",destinationid:"destinationId",room:"room",room_count:"roomCount",adult:"adult",child:"child",child_ages:"childAges",infants:"infants",room2_adult:"room2Adult",room2_child:"room2Child",room2_child_ages:"room2ChildAges",room3_adult:"room3Adult",room3_child:"room3Child",room3_child_ages:"room3ChildAges",room4_adult:"room4Adult",room4_child:"room4Child",room4_child_ages:"room4ChildAges",currency:"currency",group:"group",locale:"locale",hotel:"hotel",promo:"promo",promocode:"promocode",selfbook:"selfbook",iatanumber:"iataNumber",couponcode:"couponCode",nights:"nights",reservationid:"reservationId",lastname:"lastName",search:"search",sbsearch:"sbsearch",threeDsContinueId:"three_ds_continue_id",status:"status",roomcategory:"roomCategory",properties:"properties",source:"source",include_inclusive_fees:"includeInclusiveFees",hotelid:"hotelId",version:"version",loyaltyuseremail:"loyaltyUserEmail",loyaltyeventname:"loyaltyEventname",loyaltysignupform:"loyaltySignupForm"};return Array.from(e.entries()).reduce((e,[n,o])=>({...e,[t[n.toLowerCase()]]:o}),{})}function E(){setTimeout(()=>{const t=setInterval(()=>{if(o||l)return;clearInterval(t);const n=S(new URLSearchParams(window.location.search));if("true"!==n.selfbook)return;const a=getHotelBasicData(n.hotel||n.hotelId||e),r=n.version?.toLowerCase?.();SELFBOOK_APP_VERSION=r||a?.app_version||"v2",w(n,a)},100)},500)}function w(e,t={}){const n=parseInt(t?.default_adult_occupancy)||2,o=[{type:"adult",count:e.adult||n},{type:"child",count:e.child||0},{type:"infants",count:e.infants||0}];f({...e,guests:o,groupCode:e.group,currency:e.currency||e.currencyCode,promoCode:e.promo||e.promocode,hotelId:e.hotel||e.hotelId||void 0,roomCategory:"string"==typeof e.roomCategory?e.roomCategory.split(",").map(e=>e.trim()):void 0})}async function b(){!function(){const e=document.createElement("div"),t=document.createElement("div");e.setAttribute("id","selfbook_sdkwidget"),e.style.display="none",t.setAttribute("id","selfbook_sdkwidget_wrapper"),t.style.background="rgba(0, 0, 0, 0)",t.style.position="fixed",t.style.top="0",t.style.right="0",t.style.width="100%",t.style.transition="background .5s ease-out",t.appendChild(e),document.body.appendChild(t)}(),await m(),function(){if(!0!==s){if(n&&n.length>0){const e=document.getElementsByTagName("head")[0];n.forEach(t=>{if(t.includes(".css")){const n=document.createElement("link");n.rel="stylesheet",n.type="text/css",n.media="all",n.href=`${SELFBOOK_APP_BASE_URL}/${t}`,e.appendChild(n)}})}s=!0}}(),_(),document?.querySelectorAll("a").forEach(t=>{t.addEventListener("click",t=>{try{"A"!==t.target.tagName&&"A"===t.target.parentNode?.tagName&&(t.target.href=t.target.parentNode.href);const n=t.target.href||"";if(-1===n.indexOf("?"))return;const o=S(new URLSearchParams(n.substring(n.indexOf("?")))),a=getHotelBasicData(o.hotelId||o.hotel||e);if(SELFBOOK_APP_VERSION=o.version?.toLowerCase?.()||a?.app_version||"v2",a?.mobile_display_only&&window.innerWidth>=768)return;(isTemplateDomainMatch(a,t)||"true"===o.selfbook)&&(t.preventDefault(),w(o,a))}catch(e){console.error("a-element: err: ",e)}})}),"complete"===document?.readyState?E():window?.addEventListener("load",E)}function O(e){return e.toISOString()}function I(){return new Promise(e=>{const t=document.createElement("script");t.src=`https://cdn.jsdelivr.net/npm/@statsig/js-client@3/build/statsig-js-client.min.js?apikey=${STATSIG_CLIENT_KEY}`,t.defer=!0,t.onload=async()=>{try{await async function(){const e={userID:L()};let t=new window.Statsig.StatsigClient(STATSIG_CLIENT_KEY,e);await t.initializeAsync(),window.selfbookStatsigClient=t}()}catch(e){console.log("Unable to initialize Statsig client",e)}e(t)},t.onerror=t=>{console.log("Failed to load Statsig script",t),e()},document.head.appendChild(t)})}function L(){const e="selfbook_statsig_anonymous_id";let t=localStorage.getItem(e);return t||(t=crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).substring(2,15),localStorage.setItem(e,t)),t}async function k(n,r){try{o=!0;const s=r?`?id=${r}`:"",l=await u({url:`${SELFBOOK_BACKEND_URL}/hotels/info${s}`,headers:{"content-type":"application/json","API-Key":n}});sessionStorage.setItem(SELFBOOK_HOTEL_GROUP_INFO,JSON.stringify(l));const p={...l},_=getHotelBasicData(r);(function(e){const t=getFromSessionStorage(SELFBOOK_HOTEL_GROUP_INFO);return!("single"!==t?.structure||!(e?.enable_direct_distribution_network||e?.enable_flex_cancellation||e?.enable_priority_upgrade))||!("group"!==t?.structure||!t?.hotels.some(e=>e.enable_direct_distribution_network||e.enable_flex_cancellation||e.enable_priority_upgrade))||!("multiple_properties"!==t?.structure||!t?.hotels.some(e=>e.enable_direct_distribution_network||e.enable_flex_cancellation||e.enable_priority_upgrade))})(_)&&await I(),d(_);const m=getIsLayers(_);!_?.enable_direct_distribution_network||m||c||"none"===_?.ddn_box_device||initWidgets({apiKey:t,hotelId:e,hotelData:_}),m||initFloatingSearchbar({apiKey:t,hotelId:e});const g=S(new URLSearchParams(window.location.search));if(SELFBOOK_APP_VERSION=g.version?.toLowerCase?.()||_?.app_version||"v2",m?SELFBOOK_APP_BASE_URL=SELFBOOK_BASE_URL_LAYERS:SELFBOOK_APP_VERSION.match(/^v3/i)?(SELFBOOK_APP_BASE_URL=SELFBOOK_BASE_URL_V3,p.hotels=p?.hotels?.map(e=>({...e,enable_v3_new_ui_version:!0}))):SELFBOOK_APP_BASE_URL=SELFBOOK_BASE_URL,sessionStorage.setItem(SELFBOOK_HOTEL_GROUP_INFO,JSON.stringify(p)),!i&&getIsEnableV35(_)&&_?.is_default_date_logic_enabled&&"group"!==p?.structure)try{const t=await async function(t,n,o){try{const a=function(){const e=new Date,t=new Date(e.getFullYear(),e.getMonth(),1),n=new Date(e.getFullYear(),e.getMonth()+2,0);return{startDate:A(t),endDate:A(n)}}(),r={start_date:a.startDate,end_date:a.endDate,currency_code:o?.currency_code||"USD",guests:[{type:"adult",count:o?.default_adult_occupancy||2}]};window.sb_sdkBus.emit("sdk-calendar-status",{type:"loading",payload:r});const s=await u({url:`${"v2"===SELFBOOK_APP_VERSION?SELFBOOK_BACKEND_URL:SELFBOOK_BACKEND_URL.replace("v2","v3")}/hotels/${n||e}/calendar`,headers:{"content-type":"application/json","API-Key":t},data:JSON.stringify(r),method:"POST"});return initialCalendarResponse=s,window.sb_sdkBus.emit("sdk-calendar-status",{type:"success",payload:s}),s.data}catch(e){window.sb_sdkBus.emit("sdk-calendar-status",{type:"error",error:e.message}),console.log(e)}}(n,r,_),o=function(e){const t=new Date,n=t.getUTCFullYear(),o=t.getUTCMonth(),a=t.getUTCDate(),r=new Date(Date.UTC(n,o,a+14));let s=e.filter(e=>function(e){const[t,n,o]=e.split("-").map(Number);return new Date(Date.UTC(t,n-1,o))}(e.date)>r&&null!=e.price);0===s.length&&(s=e.filter(e=>null!=e.price));return 0===s.length?null:s.reduce((e,t)=>t.price<e.price?t:e)}(t);if(o&&o?.date){i=!0;const t=function(e){const t=new Date(e?.date),n=new Date(t);return n.setDate(t.getDate()+(e?.min_stay?e?.min_stay:1)),{startDate:O(t),endDate:O(n)}}(o);initialV35AvailabilityStartEndDates={startDate:t.startDate,endDate:t.endDate},async function(t,n,o,a){try{const r=S(new URLSearchParams(window.location.search)),s={start_date:a.startDate?.replace(/T.*$/,""),end_date:a.endDate?.replace(/T.*$/,""),currency_code:o?.currency_code||"USD",guests:[{type:"adult",count:o?.default_adult_occupancy||2}],ddn_flow:"gated",include_flex_cancel_rates:!0,include_inclusive_fees:"false"!==r.includeInclusiveFees&&("true"===r.includeInclusiveFees||void 0)};window.sb_sdkBus.emit("sdk-availability-status",{type:"loading",payload:{bodydata:s}});const i=await u({url:`${"v2"===SELFBOOK_APP_VERSION?SELFBOOK_BACKEND_URL:SELFBOOK_BACKEND_URL.replace("v2","v3")}/hotels/${n||e}/availability`,headers:{"content-type":"application/json","API-Key":t},data:JSON.stringify(s),method:"POST"});return void window.sb_sdkBus.emit("sdk-availability-status",{type:"success",payload:{response:i,bodydata:s}})}catch(e){window.sb_sdkBus.emit("sdk-availability-status",{type:"error",error:e.message}),console.log(e)}}(n,r,_,t)}}catch(e){window.sb_sdkBus.emit("sdk-calendar-status",{type:"error",error:e.message})}return a||b(),a=!0,o=!1,_}catch(e){console.log(e)}}const A=e=>`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`;const B=document?.getElementById("selfbook_jssdk");if(B){const n=new URL(B.getAttribute("src"));if(e=n.searchParams.get("hotelId"),t=n.searchParams.get("apiKey"),c="true"===n.searchParams.get("ddnLandingPage"),"?11howard"===window.location.search&&window.location.href.includes("staging")&&(e="66350",t="x9GTqyGB8Pboi5Tkk3fuQUrQ8qAecxzxNY0"),!t||!e)throw new Error("(!) selfbook: ApiKey and HotelId are required.");window.isSelfbookSDKActive=!0,initSDKBus(),k(t,e).then(e=>{getIsLayers(e)||h()})}window&&(window.sbApiLogger=function(n,o={},a){const r=`${"v2"===SELFBOOK_APP_VERSION?SELFBOOK_BACKEND_URL:SELFBOOK_BACKEND_URL.replace("v2","v3")}/hotels/${a||e}/events`;try{const e={generated_at:(new Date).toISOString(),event_source:"SDK",event_name:n,body:JSON.stringify(o)};fetch(r,{method:"POST",headers:{"Content-Type":"application/json","API-Key":t},body:JSON.stringify(e)})}catch(e){console.error("sbApiLogger error:",e)}},window.book=function(e,t,n,o,a,r,s,i,l,c,d="fr",u,p,_){f({startDate:e,endDate:t,guests:n,propertyId:o,currency:a,roomId:r,ratePlanCode:s,rate:i,promoCode:l,groupCode:c,locale:d,destinationId:p,hotelId:u,roomCategory:_})},window.bookNow=f,window.closeSelfbookWidget=function(){const e=getElementById("selfbook_sdkwidget"),t=getElementById("selfbook_sdkwidget_wrapper");setOverflowHidden(!1),e.setAttribute("class","slide-out"),t.style.background="rgba(0, 0, 0, 0)",window.selfbookWidgetStore.dispatch({type:"WIDGET/SELFBOOK_WIDGET_CLOSED"}),window.selfbookWidgetStore.dispatch({type:"ANALYTICS/TRACK_EVENT",payload:{eventType:"widget closed"}}),window.toggleShowSBSignalBox?.(!0),setTimeout(()=>{e.style.display="none",t.style.zIndex=-2147483646},800)})}runDirectApplication();

/*
  The Royce Hotel - Direct
  Hotel id: 38362
  https://roycehotel.com.au/
*/

console.log(
    '%cCustom script has been initialized',
    'background: green; color: white;',
);

// https://bugsnagerrorreportingapi.docs.apiary.io/#

const sb_int_releaseStage = 'sb_integrations'; // Useful for creating a filter
const API_KEY_BUGSNAG = '6cb771be223c608f92775d1516dce6e2';
const CLIENT_URL = window.location.href;
async function sendErrorToBugsnag(error, func) {
  const apiKey = API_KEY_BUGSNAG;
  const apiUrl = 'https://notify.bugsnag.com';


  const payload = {
    apiKey: apiKey,
    notifier: {
      name: 'Custom Notifier',
      version: '1.0',
      url: CLIENT_URL,
    },
    events: [
      {
        payloadVersion: '5',
        exceptions: [
          {
            errorClass: 'SbIntegration',
            message: `${error.name ? error.name : ''}. Message: ${error.message}.`,
            stacktrace: [
              {
                file: CLIENT_URL,
                method: ' (' + func + ' Error) ',
                code: {
                  1: `${error.name ? error.name : ''}. Message: ${error.message}.`,
                  2: 'Url: ' + window.location.href,
                  3: 'Browser: ' + navigator.userAgent,
                },
              },
            ],
          },
        ],
        severity: 'error',
        context: CLIENT_URL,
        app: {
          releaseStage: sb_int_releaseStage,
        },
      },
    ],
  };

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Bugsnag-Api-Key': apiKey,
    'Bugsnag-Payload-Version': '5',
    'Bugsnag-Sent-At': new Date().toISOString(),
  });

  const requestOptions = {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload),
  };

  try {
    const response = await fetch(apiUrl, requestOptions);
    if (response.ok) {
      console.log('Error report sent successfully');
    } else {
      console.error('Failed to send error report');
    }
  } catch (error) {
    console.error('Error sending error report:', error);
  }
};

function handleError(error, func) {
  console.error(`${func} error occurred:`, error);
  sendErrorToBugsnag(error, func); // Forward the error to Bugsnag reporting
};

function modifyExistingSbLinks() {
  const links = document.querySelectorAll(`a[href*='?selfbook=true']`);
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href) {
      // params { "hotel": "4187", "Chain": "29844", "locale": "en-US", "arrive": "08.08.2023", "depart": "08.08.2023", ... }
      const params = Object.fromEntries(new URLSearchParams(
          href.substring(href.indexOf('?')),
      ));
      const finalParams = assignObjectVals(params);
      link.setAttribute('href', window.location.href);
      link.addEventListener('click', (e) => {
        e.preventDefault();
        bookNow(finalParams);
        console.log('modifyExistingSbLinks() finalParams', finalParams);
      });
    }
  }
}
modifyExistingSbLinks();

// Checks the format of the inputted date and puts it in the correct order format (YYYY-MM-DD)
function convertDate(date) {
  try {
    const inputDate = new Date(date);
    const year = inputDate.getFullYear();
    const month = (inputDate.getMonth() + 1).toString().padStart(2, '0');
    const day = inputDate.getDate().toString().padStart(2, '0');
    return [year, month, day].join('-');
  } catch (error) {
    handleError(error, 'convertDate');
  }
};

// Validates date format is 'YYYY-MM-DD'
function checkDateIsISOformat(inputString) {
  try {
    const regexPattern = /^\d{4}-\d{2}-\d{2}$/;
    return regexPattern.test(inputString);
  } catch (error) {
    handleError(error, 'checkDateIsISOformat');
  }
}

/* Verifies these date formats:  'DD MONTH YYYY',  'YYYY-MM-DD',  'YYYY/MM/DD',  'MM/DD/YYYY' */
function verifyFutureDate(date) {
  try {
    if (date) {
      if (checkDateIsISOformat(date)) {
        const inputDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (inputDate >= today) {
          const formattedDate = inputDate.toISOString().split('T')[0];
          return formattedDate;
        }
      } else {
        const inputDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (inputDate >= today) {
          return convertDate(inputDate);
        }
      }
    }
    return '';
  } catch (error) {
    handleError(error, 'verifyFutureDate');
  }
}

/* This function filters the initial parameters and returns the ones that
     are null of undefined, it also flattens the array / object within guests */
function pruneObjectKeys(object) {
  try {
    const pruneObject = object;

    if (pruneObject.guests && Array.isArray(pruneObject.guests)) {
      const guests = pruneObject.guests;

      for (const guest of guests) {
        if (guest.type === 'adult' && guest.count > 0) {
          pruneObject.adult = guest.count;
        } else if (guest.type === 'child' && guest.count > 0) {
          pruneObject.child = guest.count;
        }
        // else if (guest.type === 'infants' && guest.count > 0) {
        //   pruneObject.infants = guest.count;
        // }
      }
      delete pruneObject.guests;
    }

    // Remove any properties with null or undefined values
    Object.keys(pruneObject).forEach((key) => {
      if (pruneObject[key] === null || pruneObject[key] === undefined || pruneObject[key] === '') {
        delete pruneObject[key];
      }
    });
    // console.log('pruneObject', pruneObject);
    return pruneObject;
  } catch (error) {
    handleError(error, 'pruneObjectKeys');
  }
}

/* Fix for Currency Case Bug */
function upperCaseCurrency(currency) {
  try {
    if (!currency) {
      return null;
    }
    const currencyCode = currency.toUpperCase();
    return currencyCode;
  } catch (error) {
    handleError(error, 'upperCaseCurrency');
  }
};
/* This function defines the bookNow() Object and assigns the values
      after running it through pruneObjectKeys().  */
function assignObjectVals(param) {
  try {
    const urlData = param;
    const arrive = urlData.arrive ? urlData.arrive : urlData.startdate;
    const depart = urlData.depart ? urlData.depart : urlData.enddate;
    const bookNowParams = {
      startDate: verifyFutureDate(arrive),
      endDate: verifyFutureDate(depart),
      guests: [
        {
          type: 'adult',
          count: (!urlData.adult ? null : parseInt(urlData.adult, 10)),
        },
        {
          type: 'child',
          count: (!urlData.child ? null : parseInt(urlData.child, 10)),
        },
      ],
      propertyId: urlData.propertyId,
      currency: upperCaseCurrency(urlData.currency),
      roomId: urlData.room ? urlData.room : urlData.roomid,
      ratePlanCode: urlData.rate ? urlData.rate : urlData.rateplancode,
      promoCode: urlData.promo ? urlData.promo : urlData.promocode,
      groupCode: urlData.group,
      locale: urlData.locale,
      hotelId: urlData.hotel,
      iataNumber: urlData.agencyid,
    };
    return pruneObjectKeys(bookNowParams);
  } catch (error) {
    handleError(error, 'assignObjectVals');
  }
};
// Create a function that parses the URL and returns an object with the params
function parseURL(url) {
  try {
    const params = {};
    let urlInput = url.replace(/%20/g, '');
    urlInput = urlInput.toLowerCase().split('?');
    const urlParams = urlInput[1].split('&');
    for (let i = 0; i < urlParams.length; i++) {
      const param = urlParams[i].split('=');
      params[param[0]] = param[1];
    }
    const searchParams = decodeURIComponent(
        new URLSearchParams(assignObjectVals(params)),
    ).toString();
      // eslint-disable-next-line max-len
    const domain = `${window.location.pathname}?selfbook=true&${searchParams}`;
    return [domain, params, searchParams];
  } catch (error) {
    handleError(error, 'parseURL');
  }
};
/* Find booking links with specific keywords, then point them to Selfbook */
function linkReplacer() {
  const allSynxisLinks = document.querySelectorAll(`a[href*='synxis']`);
  // const allSynxisLinks = document.querySelectorAll(`a[href*='reservations'], a[href*='synxis']`);
  for (let i = 0; i < allSynxisLinks.length; i++) {
    allSynxisLinks[i].removeAttribute('target');

    const link = allSynxisLinks[i].href.toString().toLowerCase();
    const parsedLink = parseURL(link);
    if (link.indexOf('signin') === -1) {
      const finalParams = assignObjectVals(parsedLink[1]);
      allSynxisLinks[i].href = parseURL(link)[0];
      allSynxisLinks[i].addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        bookNow(finalParams);
      });
    } else {
      allSynxisLinks[i].href = `/?selfbook=true&sbsearch=true&hotel=${parsedLink[1].hotel}`;
      allSynxisLinks[i].addEventListener('click', (e) => {
        e.preventDefault();
      });
    }
  }
};

linkReplacer();

// Clone a CTA
function bookNowCloner() {
  if (document.querySelectorAll('a.booknow.open-booking-popout')) {
    document.querySelectorAll('a.booknow.open-booking-popout').forEach((bookNowButton) => {
      if (bookNowButton !== null) {
        const bookNowButtonClone = bookNowButton.cloneNode(true);
        bookNowButton.parentNode.replaceChild(bookNowButtonClone, bookNowButton);
        bookNowButtonClone.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // eslint-disable-next-line no-undef
          bookNow();
        });
      }
    });
  }
}
bookNowCloner();

// Example usage of assignObjectVals(obj), leverages existing validation
// if (document.querySelector('body > form > input[type=submit]')) {
//   document.querySelector('body > form > input[type=submit]')
//     .addEventListener('click', function (e) {
//       try {
//         e.preventDefault();
//         const obj = {};
//         // Use SynXis params as object keys, i.e., adult, child, promo, rate, etc
//         obj.arrive = document.querySelector('body > form > div > label:nth-child(1) > input').value;
//         obj.depart = document.querySelector('body > form > div > label:nth-child(2) > input').value;
//         bookNow(assignObjectVals(obj));
//       } catch (error) {
//         handleError(error,"formInputs");
//       }
//     });
// }

/* for dynamic elements/apps, use this code to grab anchor tags then add event listeners */

// document.addEventListener("click", function (e) {
//   if (e.target && e.target.nodeName == "A") {
//   try {
//     let hlink = e.target.href.toString().toLowerCase();
//     if (hlink.includes("synxis") || hlink.includes("reservations.hotel.com")) {
//       e.preventDefault();
//       e.stopPropagation();
//       e.target.removeAttribute("target");

//       let parsedLink = parseURL(hlink);
//       bookNow(assignObjectVals(parsedLink[1]))
//     }
//   } catch (error) {
//       handleError(error,"clickEventListener");
//   }
//   }
// });

(() => {
  const customStyles = document.createElement('style');
  customStyles.innerText = `
    /* Remove outline from "Complete your booking" */
    button#selfbook-sdkwidget-resume:focus {
        outline:0 !important;
    }
  `;
  document.head.appendChild(customStyles);
})();

// Global error capture
window.onerror = (message, source, lineno, colno, error) => {
  // only track errors relating to selfbook
  if (
    source &&
      source.toString().includes('selfbook') &&
      !source.toString().includes('selfbook=true')) {
    if (message && !message.toString().toLowerCase().includes('resizeobserver')) {
      const customError = {};
      customError.name = message?.toString().split(' ')[0];
      customError.message = `
      message: ${message}.
      source: ${source}.
      lineno: ${lineno}.
      colno: ${colno}.
      error: ${error}.`;
      handleError(customError, 'window.onerror');
      return false;
    }
  }
};


// console.log('SB Not Loaded');

// function sbLinkCloner(cta) {
//   const bookNowButton = cta;
//   if (bookNowButton !== null) {
//     const bookNowButtonClone = bookNowButton.cloneNode(true);
//     bookNowButton.parentNode.replaceChild(bookNowButtonClone, bookNowButton);
//     bookNowButtonClone.addEventListener('click', (e) => {
//       e.preventDefault();
//       e.stopPropagation();
//       const sLink = `https://be.synxis.com/?hotel=38362`;
//       window.open(sLink, '_blank');
//     });
//   }
// }

// function removeSbLinks() {
//   if (document.querySelectorAll(`a[href*='selfbook=true']`)) {
//     // console.log('sb links present')
//     const links = document.querySelectorAll(`a[href*='selfbook=true']`);
//     for (const link of links) {
//       sbLinkCloner(link);
//       link.href = '#';
//     }
//   }
// }
// removeSbLinks();
// setInterval(() => {
//   removeSbLinks();
// }, 1000);


