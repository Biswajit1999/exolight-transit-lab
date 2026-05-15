#version 300 es
precision highp float;
out vec4 fragColor;
uniform float uRpRs;
uniform float uARs;
uniform float uInclinationRad;
uniform float uEccentricity;
uniform float uOmegaRad;
uniform float uT0;
uniform float uPeriod;
uniform vec4 uLimb;
uniform float uExposure;
uniform float uTimeMin;
uniform float uTimeMax;
uniform int uTimeCount;
uniform vec3 uSpot1;
uniform float uSpot1Contrast;
uniform int uEnableSpot;
const float PI = 3.141592653589793;
const int RADIAL_STEPS = 72;
const int ANGULAR_STEPS = 144;
float nonlinearLimbDarkening(float r){float mu=sqrt(max(0.0,1.0-r*r));return max(1.0-uLimb.x*(1.0-sqrt(mu))-uLimb.y*(1.0-mu)-uLimb.z*(1.0-mu*sqrt(mu))-uLimb.w*(1.0-mu*mu),0.0);}
float solveKepler(float M,float e){float E=M;for(int i=0;i<8;i++){float f=E-e*sin(E)-M;float fp=1.0-e*cos(E);E-=f/max(fp,1e-6);}return E;}
vec2 projectedPlanetPosition(float time){float M=mod(2.0*PI*(time-uT0)/uPeriod,2.0*PI);float E=solveKepler(M,uEccentricity);float cosf=(cos(E)-uEccentricity)/(1.0-uEccentricity*cos(E));float sinf=(sqrt(max(0.0,1.0-uEccentricity*uEccentricity))*sin(E))/(1.0-uEccentricity*cos(E));float f=atan(sinf,cosf);float r=uARs*(1.0-uEccentricity*cos(E));float arg=f+uOmegaRad;return vec2(-r*cos(arg),-r*sin(arg)*cos(uInclinationRad));}
float starspotMultiplier(vec2 p){if(uEnableSpot==0)return 1.0;float d=distance(p,uSpot1.xy);float edge=smoothstep(uSpot1.z,uSpot1.z*0.78,d);return mix(1.0-uSpot1Contrast,1.0,edge);}
float integrateFlux(float time){vec2 planet=projectedPlanetPosition(time);float total=0.0;float visible=0.0;for(int ir=0;ir<RADIAL_STEPS;ir++){float r0=float(ir)/float(RADIAL_STEPS);float r1=float(ir+1)/float(RADIAL_STEPS);float r=sqrt(0.5*(r0*r0+r1*r1));float area=PI*(r1*r1-r0*r0)/float(ANGULAR_STEPS);float base=nonlinearLimbDarkening(r);for(int ia=0;ia<ANGULAR_STEPS;ia++){float th=2.0*PI*(float(ia)+0.5)/float(ANGULAR_STEPS);vec2 p=vec2(r*cos(th),r*sin(th));float weight=base*starspotMultiplier(p)*area;total+=weight;float blocked=step(distance(p,planet),uRpRs);visible+=weight*(1.0-blocked);}}return visible/max(total,1e-8);}
void main(){float idx=clamp(gl_FragCoord.x-0.5,0.0,float(uTimeCount-1));float phase=idx/float(max(uTimeCount-1,1));float time=mix(uTimeMin,uTimeMax,phase);float f0=integrateFlux(time-0.5*uExposure);float f1=integrateFlux(time);float f2=integrateFlux(time+0.5*uExposure);float flux=(f0+4.0*f1+f2)/6.0;fragColor=vec4(flux,time,0.0,1.0);}
