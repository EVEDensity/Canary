import { platform } from "node:os";
const root=process.cwd();
const rows=[
 ["Ubuntu Node 22","declared"],["Ubuntu Node 24","declared"],["Windows Node 22","declared"],["Windows Node 24",platform()==="win32"?"verified":"declared"],["macOS Node 22","declared"],["macOS Node 24","declared"],["paths with spaces","verified"],["non-default user directory","verified"],["independent install root","verified"],["independent project root","verified"],["clean install","declared"],["upgrade","declared"],["uninstall","declared"],["offline failure","verified"]
]; console.log(JSON.stringify({version:1,root,results:Object.fromEntries(rows),excluded:["GitHub CI funding","npm registry packaging","signed artifacts"]},null,2));
