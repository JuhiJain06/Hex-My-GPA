window.RIG={
'fox-study':[{k:'ear',b:[215,75],t:[190,18]},{k:'ear',b:[300,70],t:[330,12]},{k:'tail',b:[360,210],t:[405,95]}],
'fox-break':[{k:'ear',b:[180,75],t:[155,15]},{k:'ear',b:[255,65],t:[280,5]},{k:'tail',b:[160,245],t:[70,125]}],
'fox-sleep':[{k:'ear',b:[156,111],t:[124,71]},{k:'ear',b:[220,87],t:[232,27]}],
'bunny-study':[{k:'ear',b:[245,78],t:[235,10]},{k:'ear',b:[295,78],t:[305,10]}],
'bunny-break':[{k:'ear',b:[210,70],t:[214,10]},{k:'ear',b:[270,70],t:[282,18]}],
'bunny-sleep':[{k:'ear',b:[232,61],t:[164,53]},{k:'ear',b:[180,101],t:[112,117]}]};
window.warpCanvas=function(img,parts,slow){
  const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
  const x=c.getContext('2d');x.drawImage(img,0,0);const W=c.width,H=c.height;
  const src=x.getImageData(0,0,W,H);const out=x.createImageData(W,H);
  const P=parts.map((p,i)=>{const dx=p.t[0]-p.b[0],dy=p.t[1]-p.b[1],L=Math.hypot(dx,dy),r=Math.max(18,L*.55);
    const x0=Math.max(0,Math.floor(Math.min(p.b[0],p.t[0])-r)),x1=Math.min(W,Math.ceil(Math.max(p.b[0],p.t[0])+r)),
          y0=Math.max(0,Math.floor(Math.min(p.b[1],p.t[1])-r)),y1=Math.min(H,Math.ceil(Math.max(p.b[1],p.t[1])+r));
    return {...p,dx,dy,L,r,x0,x1,y0,y1,ph:i*1.7+Math.random()}});
  function frame(ms){
    const t=ms/1000;out.data.set(src.data);
    for(const p of P){
      let a;
      if(p.k==='tail') a=(slow?.05:.13)*Math.sin(t*(slow?1.1:2.4)+p.ph);
      else{const tw=Math.max(0,Math.sin(t*0.9+p.ph))**24; a=(slow?.03:.06)*Math.sin(t*(slow?.9:1.8)+p.ph)+(slow?0:.16*tw*Math.sin(t*22))}
      for(let y=p.y0;y<p.y1;y++)for(let X=p.x0;X<p.x1;X++){
        const ux=X-p.b[0],uy=y-p.b[1];
        const s=(ux*p.dx+uy*p.dy)/(p.L*p.L);if(s<=0||s>1.35)continue;
        const px=p.b[0]+p.dx*Math.min(s,1),py=p.b[1]+p.dy*Math.min(s,1);
        const dist=Math.hypot(X-px,y-py);if(dist>p.r)continue;
        const fall=1-Math.pow(dist/p.r,2);
        const w=Math.min(1,s)**1.3*fall;const th=-a*w,co=Math.cos(th),si=Math.sin(th);
        const sx=Math.round(p.b[0]+ux*co-uy*si),sy=Math.round(p.b[1]+ux*si+uy*co);
        const o=(y*W+X)*4;
        if(sx<0||sy<0||sx>=W||sy>=H){out.data[o+3]=0;continue}
        const q=(sy*W+sx)*4;out.data[o]=src.data[q];out.data[o+1]=src.data[q+1];out.data[o+2]=src.data[q+2];out.data[o+3]=src.data[q+3];
      }}
    x.putImageData(out,0,0);requestAnimationFrame(frame)}
  requestAnimationFrame(frame);return c};
