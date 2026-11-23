import React from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  Book,
  Building2,
  Car,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Layers,
  Music,
  PawPrint,
  Plane,
  Shield,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tag,
  Ticket,
  Tv,
  Utensils,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react';
import type { CategoryIconKey } from '../domain/categories';

const ICON_COMPONENTS: Record<
  CategoryIconKey | 'arrow-left-right',
  React.ComponentType<{ className?: string }>
> = {
  tag: Tag,
  home: Home,
  dumbbell: Dumbbell,
  'heart-pulse': HeartPulse,
  'paw-print': PawPrint,
  utensils: Utensils,
  shirt: Shirt,
  gift: Gift,
  plane: Plane,
  'graduation-cap': GraduationCap,
  sparkles: Sparkles,
  car: Car,
  'alert-circle': AlertCircle,
  'shopping-bag': ShoppingBag,
  coffee: Coffee,
  music: Music,
  wrench: Wrench,
  book: Book,
  zap: Zap,
  droplets: Droplets,
  flame: Flame,
  wifi: Wifi,
  smartphone: Smartphone,
  tv: Tv,
  shield: Shield,
  'building-2': Building2,
  'shopping-cart': ShoppingCart,
  ticket: Ticket,
  layers: Layers,
  'arrow-left-right': ArrowLeftRight,
};

interface CategoryIconProps {
  icon: CategoryIconKey | 'arrow-left-right';
  className?: string;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({ icon, className = 'w-4 h-4' }) => {
  const Component = ICON_COMPONENTS[icon] ?? Tag;
  return <Component className={className} />;
};
