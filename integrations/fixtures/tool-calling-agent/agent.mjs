export default async (input, ctx) => { ctx.emit({type:'tool.call',name:'echo',args:{value:input}}); return ctx.tools.call('echo', {value:input}); };
