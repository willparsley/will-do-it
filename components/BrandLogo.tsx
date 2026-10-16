import Image from 'next/image';
import styles from './BrandLogo.module.css';

/** CSS follows the resolved root theme without waiting for client hydration. */
export function BrandLogo({ size = 'header' }: { size?: 'header' | 'login' }) {
  return <span className={`${styles.logo} ${styles[size]}`}>
    <Image src="/branding/willdoit-logo-light.svg" alt="Will Do It" width={720} height={288}
      className={styles.light} unoptimized loading="eager" />
    <Image src="/branding/willdoit-logo-dark.svg" alt="Will Do It" width={720} height={288}
      className={styles.dark} unoptimized loading="eager" />
  </span>;
}
