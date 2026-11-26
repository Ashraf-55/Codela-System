import { medical } from './defs/medical';
import { realestate } from './defs/realestate';
import { ecommerce } from './defs/ecommerce';
import { restaurant } from './defs/restaurant';
import { automotive } from './defs/automotive';
import { learning } from './defs/learning';
import { construction } from './defs/construction';
import { booking } from './defs/booking';
import { fleet } from './defs/fleet';
import { business } from './defs/business';
import type { ProductDef } from './framework';
import { withStatusNotifications } from './status-notify';
import { withCustomerPayments } from './customer-payments';

export const PRODUCTS: Record<string, ProductDef> = Object.fromEntries(Object.entries({ medical, realestate, ecommerce, restaurant, automotive, learning, construction, booking, fleet, business }).map(([k, v]) => [k, withCustomerPayments(withStatusNotifications(v))]));
export const getProduct = (slug: string) => PRODUCTS[slug];
