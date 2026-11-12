from PIL import Image
src = r".zwork/attachments/d0238f7a-738b-430e-9322-2f54a082642a/scifi-191236989.webp"
im = Image.open(src).convert('RGBA')
print(im.size)
im.save('docs/ref-reticle.png')
im2 = im.copy()
im2.thumbnail((900, 900))
im2.save('docs/ref-reticle-small.png')
