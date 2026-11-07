import { MAX_SCENE_LIGHTS } from "./schema";
export const sceneVertex = `precision highp float;
attribute vec2 aVertexPosition;attribute vec2 aTextureCoord;
uniform mat3 translationMatrix;uniform mat3 projectionMatrix;uniform mat4 uModel;uniform vec4 uCamera;uniform mat3 uViewRotation;uniform float uFocal;uniform float uClipDepth;
varying vec2 vUV;varying vec3 vWorld;varying vec3 vNormal;
void main(){vec4 world=uModel*vec4(aVertexPosition,0.0,1.0);vWorld=world.xyz;vNormal=-normalize(cross(uModel[0].xyz,uModel[1].xyz));vec3 view=uViewRotation*(world.xyz-uCamera.xyz);float w=(uClipDepth>.5?view.z:max(20.0,view.z))/uFocal;vec3 clip=projectionMatrix*translationMatrix*vec3(view.xy*uCamera.w,w);gl_Position=vec4(clip.xy,uClipDepth>.5?w-40.0/uFocal:0.0,w);vUV=aTextureCoord;}`;
export const sceneFragment = `precision highp float;
varying vec2 vUV;varying vec3 vWorld;varying vec3 vNormal;
uniform sampler2D uSampler;uniform float uAlpha;uniform float uLighting;uniform float uLightCount;uniform vec2 uTexel;
uniform vec3 uViewPosition;uniform vec3 uPlaneRight;uniform vec3 uPlaneUp;uniform vec4 uMaterial;uniform vec4 uAmbient;uniform float uExposure;
uniform vec4 uLightPos[${MAX_SCENE_LIGHTS}];uniform vec4 uLightColor[${MAX_SCENE_LIGHTS}];uniform vec4 uLightDir[${MAX_SCENE_LIGHTS}];
uniform vec4 uLightRight[${MAX_SCENE_LIGHTS}];uniform vec4 uLightUp[${MAX_SCENE_LIGHTS}];uniform vec4 uLightParams[${MAX_SCENE_LIGHTS}];
float atten(float dist,float range,float decay){float q=dist/max(1.0,range);return (1.0-smoothstep(.75,1.0,q))/(1.0+pow(dist/max(1.0,range*.5),decay));}
void illuminate(vec3 L,vec3 radiance,vec3 N,vec3 V,float edge,float spec,float rim,inout vec3 diffuse,inout vec3 shine){
 float lambert=max(0.0,dot(N,L));diffuse+=radiance*lambert;
 vec3 H=normalize(L+V+vec3(.000001));float gloss=pow(max(0.0,dot(N,H)),mix(128.0,4.0,clamp(uMaterial.x,0.0,1.0)));
 shine+=radiance*(gloss*spec*uMaterial.y*step(.0001,lambert)+edge*rim*uMaterial.z*(.25+.75*lambert));
}
void main(){
 vec4 src=texture2D(uSampler,vUV);if(uLighting<.5||src.a<.00001){gl_FragColor=src*uAlpha;return;}
 vec3 base=pow(max(vec3(0.0),src.rgb/max(.00001,src.a)),vec3(2.2));
 vec3 N=normalize(vNormal),V=normalize(uViewPosition-vWorld);if(dot(N,V)<0.0)N=-N;
 float ar=texture2D(uSampler,vUV+vec2(uTexel.x,0.0)).a,al=texture2D(uSampler,vUV-vec2(uTexel.x,0.0)).a;
 float ad=texture2D(uSampler,vUV+vec2(0.0,uTexel.y)).a,au=texture2D(uSampler,vUV-vec2(0.0,uTexel.y)).a;
 vec2 grad=vec2(ar-al,ad-au);float edge=clamp(length(grad)*1.8,0.0,1.0);
 N=normalize(N-(uPlaneRight*grad.x+uPlaneUp*grad.y)*uMaterial.w*3.0);
 vec3 diffuse=uAmbient.rgb*uAmbient.a,shine=vec3(0.0);
 for(int i=0;i<${MAX_SCENE_LIGHTS};i++){
  if(float(i)>=uLightCount)break;
  vec3 power=uLightColor[i].rgb*uLightColor[i].a;float kind=uLightPos[i].w;
  if(kind<.5){diffuse+=power;continue;}
  if(kind>2.5){illuminate(-uLightDir[i].xyz,power,N,V,edge,uLightParams[i].y,uLightParams[i].z,diffuse,shine);continue;}
  if(kind>1.5){
   for(int j=0;j<4;j++){float rx=(j==0||j==2)?-.57735:.57735;float ry=j<2?-.57735:.57735;
    vec3 emitter=uLightPos[i].xyz+uLightRight[i].xyz*uLightRight[i].w*rx+uLightUp[i].xyz*uLightUp[i].w*ry;
    vec3 delta=emitter-vWorld;float dist=length(delta);vec3 L=delta/max(.001,dist);float emission=max(0.0,dot(uLightDir[i].xyz,-L));
    illuminate(L,power*atten(dist,uLightDir[i].w,uLightParams[i].x)*emission*.25,N,V,edge,uLightParams[i].y,uLightParams[i].z,diffuse,shine);
   }
  }else {vec3 delta=uLightPos[i].xyz-vWorld;float dist=length(delta);illuminate(delta/max(.001,dist),power*atten(dist,uLightDir[i].w,uLightParams[i].x),N,V,edge,uLightParams[i].y,uLightParams[i].z,diffuse,shine);}
 }
 vec3 color=pow(max(vec3(0.0),(base*diffuse+shine)*uExposure),vec3(1.0/2.2));gl_FragColor=vec4(clamp(color,0.0,1.0)*src.a,src.a)*uAlpha;
}`;
