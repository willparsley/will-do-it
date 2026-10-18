'use client';

import { Button, Tooltip, TooltipTrigger, type ButtonProps } from 'react-aria-components';
import styles from './HeaderControls.module.css';

export function TooltipButton({ tooltip, ...props }: ButtonProps & { tooltip: string }) {
  return (
    <TooltipTrigger delay={600}>
      <Button {...props} />
      <Tooltip placement="bottom" offset={8} className={styles.tooltip}>{tooltip}</Tooltip>
    </TooltipTrigger>
  );
}
