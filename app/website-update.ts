export type WebsiteInfo={version:string;build:string;entryAssets:string[]};
export function websiteChanged(loadedBuild:string,loadedAssets:string[],next:WebsiteInfo){
 return loadedBuild?next.build!==loadedBuild:JSON.stringify(next.entryAssets)!==JSON.stringify(loadedAssets);
}
