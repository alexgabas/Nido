import React from 'react';
import { ShoppingListSection } from '../components/ShoppingListSection';
import { useNido } from '../context/NidoContext';

export const CompraView: React.FC = () => {
  const { setActiveTab } = useNido();
  return (
    <ShoppingListSection
      open
      variant="page"
      onClose={() => setActiveTab('inicio')}
    />
  );
};
