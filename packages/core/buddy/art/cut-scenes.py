import sys, numpy as np
from PIL import Image, ImageFilter
from collections import deque
IM=r'C:/Users/JUHI/AppData/Local/Temp/claude/f124a8fdcf9a07cd/1b6bde4c-4bd0-44ed-85c1-81df8c2f62b8/images'
out=sys.argv[1]
files={'hamster':4,'dog':5,'bunny':6,'panda':7,'fox':8,'cat':9}
panels={'study':(176,470),'break':(496,790),'sleep':(816,1108)}
X0,X1=118,750
def dil(m,r):
    o=m.copy()
    for dy in range(-r,r+1):
        for dx in range(-r,r+1):
            if dx*dx+dy*dy<=r*r: o|=np.roll(np.roll(m,dy,0),dx,1)
    return o
def flood(free,seeds):
    h,w=free.shape; v=np.zeros((h,w),bool); q=deque()
    for p in seeds:
        if free[p] and not v[p]: v[p]=True; q.append(p)
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
                n+=1; q=deque([(y,x)]); lab[y,x]=n; cnt=0; y0=y1=y; x0=x1=x
                while q:
                    cy,cx=q.popleft(); cnt+=1; y0=min(y0,cy); y1=max(y1,cy); x0=min(x0,cx); x1=max(x1,cx)
                    for ny,nx in ((cy+1,cx),(cy-1,cx),(cy,cx+1),(cy,cx-1)):
                        if 0<=ny<h and 0<=nx<w and m[ny,nx] and not lab[ny,nx]: lab[ny,nx]=n; q.append((ny,nx))
                info.append((n,cnt,y0,y1,x0,x1))
    return lab,info
only=sys.argv[2:] or list(files)
for name,fi in files.items():
    if name not in only: continue
    im=np.array(Image.open(f'{IM}/{fi}.webp').convert('RGB')).astype(np.int32)
    paper=np.median(im[5:40,300:560].reshape(-1,3),axis=0)
    for mood,(y0,y1) in panels.items():
        if name=='hamster' and mood=='sleep': y0=874
        if name in ('fox','bunny'): y0-=40
        c=im[y0:y1,X0:X1].copy(); h,w,_=c.shape
        d=np.sqrt(((c-paper)**2).sum(2))
        ink=d>38
        def thin_runs(m,horizontal,minlen=80,maxthick=7):
            M=m if horizontal else m.T
            H,W=M.shape; out=np.zeros_like(M)
            cs=np.cumsum(np.vstack([np.zeros((1,W),int),M.astype(int)]),0)
            for y in range(H):
                a,b=max(0,y-4),min(H,y+5)
                thick=cs[b]-cs[a]
                row=M[y]&(thick<=maxthick)
                x=0
                while x<W:
                    if row[x]:
                        x2=x
                        gap=0
                        while x2<W and gap<=4:
                            gap=0 if row[x2] else gap+1; x2+=1
                        if x2-x>=minlen: out[y,x:x2]=True
                        x=x2
                    else: x+=1
            return out if horizontal else out.T
        for _ in range(2):
            lines=thin_runs(ink,True)|thin_runs(ink,False)
            ink&=~dil(lines,2)
        wall=dil(ink,3)
        border=[(0,x) for x in range(w)]+[(h-1,x) for x in range(w)]+[(y,0) for y in range(h)]+[(y,w-1) for y in range(h)]
        bg=flood(~wall,border)
        bg=flood(bg|(dil(bg,4)&(d<30)),border)
        fg=~bg
        lab,info=comps(fg)
        big=max(info,key=lambda t:t[1])[1]
        keep=np.zeros_like(fg)
        for n,cnt,a,b,l,r in info:
            touches=a==0 or b==h-1 or l==0 or r==w-1
            thin=min(b-a,r-l)<6
            nearedge=a<60 or b>h-40 or l<60 or r>w-60
            small=cnt<0.06*big
            if cnt==big or (cnt>30 and not touches and not thin and not (nearedge and small)): keep|=lab==n
        al=np.where(keep,255,0).astype(np.uint8)
        A=Image.fromarray(al).filter(ImageFilter.GaussianBlur(0.8))
        rgba=Image.fromarray(c.astype(np.uint8)).convert('RGBA'); rgba.putalpha(A)
        rgba=rgba.crop(Image.fromarray(al).getbbox()); rgba.save(f'{out}/{name}-{mood}.png'); print(name,mood,rgba.size)
names=list(files); moods=list(panels)
sheet=Image.new('RGB',(3*420,6*260),(40,48,60))
for i,n in enumerate(names):
    for j,m in enumerate(moods):
        p=Image.open(f'{out}/{n}-{m}.png'); p.thumbnail((400,240)); sheet.paste(p,(j*420+10,i*260+10),p)
sheet.save(f'{out}/preview.png')
