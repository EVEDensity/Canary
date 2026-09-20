export default {kind:'canary.project',version:1,checks:[
 {id:'resources.local',type:'resources',required:false},
 {id:'application.smoke',type:'command',command:'node',args:['-e',"setTimeout(()=>console.log('Local smoke check complete'),1800)"]},
 {id:'release.ready',type:'filesystem',path:'ready.txt',dependsOn:['application.smoke']}
],web:{open:false}};
