import sys, numpy as np
from PIL import Image, ImageFilter
from collections import deque
src=r'C:/Users/JUHI/AppData/Local/Temp/claude/f124a8fdcf9a07cd/1b6bde4c-4bd0-44ed-85c1-81df8c2f62b8/images/3.webp'
out=sys.argv[1]
im=np.array(Image.open(src).convert('RGB')).astype(np.int32)
paper=np.median(im[0:15,:].reshape(-1,3),axis=0)
cells={'cat':(0,20,384,402),'fox':(384,20,768,402),'panda':(768,20,1152,400),
       'bunny':(0,462,384,800),'dog':(384,462,768,800),'hamster':(768,462,1152,786)}
def dil(m,r):
    o=m.copy()
    for dy in range(-r,r+1):
        for dx in range(-r,r+1):
            if dx*dx+dy*dy<=r*r: o|=np.roll(np.roll(m,dy,0),dx,1)
    return o
def flood(free,seeds):
    h,w=free.shape; v=np.zeros((h,w),bool); q=deque(p for p in seeds if free[p])
    for p in q: v[p]=True
    while q:
        y,x=q.popleft()
        for ny,nx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
            if 0<=ny<h and 0<=nx<w and free[ny,nx] and not v[ny,nx]: v[ny,nx]=True; q.append((ny,nx))
    return v
def comps(m):
    h,w=m.shape; lab=np.zeros((h,w),np.int32); n=0; info=[]
    for y in range(h):
        for x in range(w):
            if m[y,x] and not lab[y,x]:
                n+=1; q=deque([(y,x)]); lab[y,x]=n; cnt=0; ys=[y,y]; xs=[x,x]
                while q:
                    cy,cx=q.popleft(); cnt+=1; ys=[min(ys[0],cy),max(ys[1],cy)]; xs=[min(xs[0],cx),max(xs[1],cx)]
                    for ny,nx in ((cy+1,cx),(cy-1,cx),(cy,cx+1),(cy,cx-1)):
                        if 0<=ny<h and 0<=nx<w and m[ny,nx] and not lab[ny,nx]: lab[ny,nx]=n; q.append((ny,nx))
                info.append((n,cnt,ys,xs))
    return lab,info
for name,(x0,y0,x1,y1) in cells.items():
    c=im[y0:y1,x0:x1]; h,w,_=c.shape
    d=np.sqrt(((c-paper)**2).sum(2))
    ink=d>40
    wall=dil(ink,3)
    border=[(0,x) for x in range(w)]+[(h-1,x) for x in range(w)]+[(y,0) for y in range(h)]+[(y,w-1) for y in range(h)]
    bg=flood(~wall,border)
    bg=flood(bg|(dil(bg,4)&(d<32)),border)   # creep into paper halo near outline only
    fg=~bg
    lab,info=comps(fg)
    big=max(info,key=lambda t:t[1])[1]
    keep=np.zeros_like(fg)
    for n,cnt,ys,xs in info:
        touches=ys[0]==0 or ys[1]==h-1 or xs[0]==0 or xs[1]==w-1
        if cnt==big or (cnt>40 and not touches): keep|=lab==n
    a=np.where(keep,255,0).astype(np.uint8)
    A=Image.fromarray(a).filter(ImageFilter.GaussianBlur(0.8))
    rgba=Image.fromarray(c.astype(np.uint8)).convert('RGBA'); rgba.putalpha(A)
    rgba=rgba.crop(Image.fromarray(a).getbbox()); rgba.save(f'{out}/{name}.png'); print(name,rgba.size)
names=list(cells)
sheet=Image.new('RGB',(6*300,640),(40,48,60)); sheet.paste((235,238,242),(0,320,1800,640))
for i,n in enumerate(names):
    p=Image.open(f'{out}/{n}.png'); p.thumbnail((280,280))
    for r in (0,1): sheet.paste(p,(i*300+10,r*320+20),p)
sheet.save(f'{out}/preview.png')
