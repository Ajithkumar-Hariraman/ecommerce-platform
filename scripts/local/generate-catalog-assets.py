import json,uuid,hashlib,zlib,struct,pathlib
root=pathlib.Path('apps/api/assets/local-catalog'); root.mkdir(parents=True,exist_ok=True)
groups=[('Bags & Travel',[('Canvas Market Tote',799),('Zip Top Cotton Tote',899),('Daily Canvas Backpack',1899),('Weekend Duffel Bag',2499),('Compact Travel Pouch',499)]),('Stationery',[('A5 Hardcover Notebook',349),('Pocket Ruled Journal',199),('Dotted Desk Planner',599),('Kraft Sketchbook',449),('Recycled Paper Notebook',299)]),('Drinkware',[('Steel Water Bottle 750ml',899),('Insulated Travel Flask 500ml',1299),('Ceramic Coffee Mug 350ml',499),('Glass Water Bottle 600ml',699),('Double Wall Tea Tumbler',799)]),('Home Textiles',[('Cotton Cushion Cover',399),('Linen Blend Cushion Cover',599),('Woven Table Runner',899),('Cotton Kitchen Towel Set',449),('Handwoven Cotton Throw',1599)]),('Desk Accessories',[('Bamboo Pen Holder',449),('Oak Desk Organizer',1299),('Cork Desk Mat',999),('Wooden Phone Stand',599),('Bamboo Letter Tray',899)]),('Planters',[('Terracotta Herb Pot',299),('Glazed Ceramic Planter',699),('Ribbed Indoor Plant Pot',799),('Mini Succulent Pot',249),('Tall Stoneware Planter',1199)])]
manifest={'categories':[],'products':[]}
for g,(category,items) in enumerate(groups):
 cid=str(uuid.uuid5(uuid.NAMESPACE_URL,'local-catalog/category/'+category)); slug='local-'+category.lower().replace(' & ','-').replace(' ','-'); manifest['categories'].append(dict(id=cid,slug=slug,name=category,status='ACTIVE'))
 for j,(name,price) in enumerate(items):
  pid=str(uuid.uuid5(uuid.NAMESPACE_URL,'local-catalog/product/'+name)); pixels=bytearray([245,241,232]*320*320); color=[(54,104,105),(163,87,61),(77,103,147),(137,104,142),(104,121,77)][j]
  def rect(x,y,w,h,c):
   for yy in range(max(0,y),min(320,y+h)):
    for xx in range(max(0,x),min(320,x+w)): pixels[(yy*320+xx)*3:(yy*320+xx)*3+3]=bytes(c)
  def circle(x,y,r,c):
   for yy in range(max(0,y-r),min(320,y+r+1)):
    for xx in range(max(0,x-r),min(320,x+r+1)):
     if (xx-x)**2+(yy-y)**2<=r*r: pixels[(yy*320+xx)*3:(yy*320+xx)*3+3]=bytes(c)
  rect(62,265,196,7,(218,211,198))
  if g==0:
   circle(160,110,47,color); circle(160,110,33,(245,241,232)); rect(83,111,154,143,color); rect(96,125,128,5,(225,207,167)); rect(134,174,52,32,(225,207,167))
  elif g==1:
   rect(83,63,159,192,(215,205,182)); rect(76,57,155,193,color); rect(88,57,5,193,(225,207,167)); rect(113,93,88,5,(225,207,167)); rect(113,107,60,4,(225,207,167)); rect(201,57,9,167,(225,207,167))
  elif g==2:
   if j==2: circle(225,166,39,color); circle(225,166,25,(245,241,232)); rect(91,108,119,137,color)
   else: rect(121,50,78,29,(61,66,66)); rect(111,80,98,175,color); rect(113,114,94,8,(225,207,167)); rect(113,211,94,8,(225,207,167))
  elif g==3:
   rect(65,80,190,174,color)
   for x in range(76,250,17): rect(x,83,3,168,(225,207,167))
   for y in range(92,250,23): rect(69,y,182,2,(225,207,167))
  elif g==4:
   rect(95,137,130,114,color); rect(108,60,9,125,(194,145,68)); rect(139,75,10,110,(67,82,103)); rect(181,53,10,132,(149,77,65)); rect(85,137,150,15,(190,159,108)); rect(124,186,70,5,(225,207,167))
  else:
   rect(153,57,10,111,(82,112,65)); circle(130,92,26,(100,137,76)); circle(184,65,27,(82,112,65)); rect(104,163,112,90,color); rect(93,149,134,25,color)
  raw=b''.join(b'\0'+pixels[y*960:(y+1)*960] for y in range(320))
  def chunk(t,d): return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
  png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',320,320,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
  filename=pid+'.png'; (root/filename).write_bytes(png)
  manifest['products'].append(dict(id=pid,sku=f'LOCAL-CATALOG-{g+1:02}-{j+1:02}',name=name,description=f'{name} for everyday use. A practical addition to your {category.lower()} collection; original illustration shows the sample style.',categoryId=cid,priceInMinorUnits=price*100,stock=20+j*7,status='ACTIVE',image=dict(bucket='local-catalog',objectName=filename,generation=hashlib.sha256(png).hexdigest(),contentType='image/png',size=len(png))))
(root/'catalog.json').write_text(json.dumps(manifest,indent=2)+'\n')
(root/'LICENSE.md').write_text('Original development catalog illustrations created for this repository using geometric drawing code. Dedicated to the public domain under CC0-1.0. No third-party photographs or trademarks. Illustrative samples, not photographs of shipped goods.\n')
