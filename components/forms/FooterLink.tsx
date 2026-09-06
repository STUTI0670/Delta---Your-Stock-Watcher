import Link from "next/link";

const FooterLink = ({ text, linkText, href }: FooterLinkProps) => {
    return (
        <div className="pt-5 text-center">
            <p className="text-[14px]" style={{ color: 'var(--ink-3)' }}>
                {text}{` `}
                <Link href={href} className="font-semibold hover:underline" style={{ color: 'var(--blue)' }}>
                    {linkText}
                </Link>
            </p>
        </div>
    )
}
export default FooterLink
