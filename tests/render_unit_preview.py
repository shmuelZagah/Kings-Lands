# python3 tests/render_unit_preview.py unit.json out.png — software preview of an imported unit (rest pose + rotated joints, 3 LODs)
import json, sys, numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
u = json.load(open(sys.argv[1]))
def rotx(a): c,s=np.cos(a),np.sin(a); return np.array([[1,0,0],[0,c,-s],[0,s,c]])
def rotz(a): c,s=np.cos(a),np.sin(a); return np.array([[c,-s,0],[s,c,0],[0,0,1]])
def build(lod, pose):
    tris=[]; cols=[]
    def walk(h, parentM, parentP, name2meshes):
        for name, node in h.items():
            M = parentM @ pose.get(name, np.eye(3))      # rotation about the joint pivot
            P = parentP + parentM @ np.array(node['pos'])
            meshes = node['meshes'] if lod==0 else (u['lods'][str(lod)].get(name, []))
            for m in meshes:
                V = np.array(m['vertices']); W = (M @ V.T).T + P
                C = np.array(m['colors'])/255.0
                for f in m['faces']:
                    t = W[f]; n = np.cross(t[1]-t[0], t[2]-t[0]); l=np.linalg.norm(n)
                    if l<1e-12: continue
                    n/=l; shade = 0.45+0.55*max(0, n @ np.array([0.3,0.5,0.8])/1.0)
                    tris.append(t); cols.append(np.clip(C[f].mean(0)*shade,0,1))
            walk(node['children'], M, P, None)
    walk(u['hierarchy'], np.eye(3), np.zeros(3), None)
    return np.array(tris), np.array(cols)
poses = {'rest': {}, 'posed': {'arm_R': rotz(-0.9), 'forearm_R': rotx(-1.1), 'arm_L': rotx(-1.3), 'shin_R': rotx(0.9), 'leg_R': rotx(-0.6), 'torso': rotx(0.15), 'head': rotz(0.3)}}
fig, axes = plt.subplots(2, 3, figsize=(15, 11))
for r,(pn,pose) in enumerate(poses.items()):
    for lod in range(3):
        tris, cols = build(lod, pose)
        # camera: 3/4 view
        a=0.6; R=np.array([[np.cos(a),0,-np.sin(a)],[0,1,0],[np.sin(a),0,np.cos(a)]])
        t2 = tris @ R.T
        nn = np.cross(t2[:,1]-t2[:,0], t2[:,2]-t2[:,0])
        keep = nn[:,2] > 0                       # back-face culling (camera looks down -z)
        t2, cols_k = t2[keep], cols[keep]
        z = t2[:,:,2].mean(1); order = np.argsort(z)
        ax=axes[r][lod]
        ax.add_collection(PolyCollection(t2[order][:,:,:2], facecolors=cols_k[order], edgecolors=(0,0,0,0.25 if lod>0 else 0.0), linewidths=0.3))
        ax.set_xlim(-1.3,1.3); ax.set_ylim(-0.05,2.0); ax.set_aspect('equal'); ax.axis('off')
        ax.set_title(f"{pn} · LOD{lod} · {len(tris)} tris")
plt.tight_layout(); plt.savefig(sys.argv[2], dpi=70)
