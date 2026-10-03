ALTER TABLE public.products ADD COLUMN image_asset jsonb;
ALTER TABLE public.products ADD CONSTRAINT products_image_asset_shape_check CHECK (
 image_asset IS NULL OR (
 jsonb_typeof(image_asset)='object' AND image_asset ?& ARRAY['bucket','objectName','generation','contentType','size']
 AND jsonb_typeof(image_asset->'bucket')='string'
 AND jsonb_typeof(image_asset->'objectName')='string'
 AND jsonb_typeof(image_asset->'generation')='string'
 AND image_asset->>'contentType' IN ('image/jpeg','image/png','image/webp')
 AND jsonb_typeof(image_asset->'size')='number'
 ));
