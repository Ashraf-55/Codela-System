-- Run once on existing databases AFTER deploying the module rename (employees -> hr) in business.ts.
-- Back up the database first. Only business-product tenants are affected.
BEGIN;
UPDATE role_permissions SET permission = 'hr.*'
 WHERE permission = 'employees.*'
   AND role_id IN (SELECT r.id FROM roles r JOIN tenants t ON t.id = r.tenant_id
                   WHERE r.name = 'manager' AND t.product_slug = 'business');
UPDATE search_index SET permission_key = 'hr.read'
 WHERE entity_type = 'employee' AND permission_key = 'employees.read'
   AND tenant_id IN (SELECT id FROM tenants WHERE product_slug = 'business');
COMMIT;
